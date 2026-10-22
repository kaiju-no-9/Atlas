package api

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"
)

const maxBodyBytes = 16 << 10

type Server struct {
	token        string
	searchAPIKey string
	logger       *slog.Logger
	mux          *http.ServeMux
}

func NewServer(token, searchAPIKey string, logger *slog.Logger) *Server {
	s := &Server{token: token, searchAPIKey: searchAPIKey, logger: logger, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.Handle("POST /v1/search", s.requireToken(http.HandlerFunc(s.search)))
	return s
}

func (s *Server) Handler() http.Handler {
	return s.recoverPanics(s.requestID(s.cors(s.mux)))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "atlas-companion"})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	if s.searchAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "search_unconfigured", "Set ATLAS_BRAVE_SEARCH_API_KEY to enable search.")
		return
	}
	var request searchRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Provide a JSON object with a non-empty query and optional result limit.")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_request", "Request body must contain exactly one JSON object.")
		return
	}
	if strings.TrimSpace(request.Query) == "" || len(request.Query) > 500 {
		writeError(w, http.StatusBadRequest, "invalid_query", "Query must contain between 1 and 500 characters.")
		return
	}
	if request.Limit == 0 {
		request.Limit = 5
	}
	if request.Limit < 1 || request.Limit > 10 {
		writeError(w, http.StatusBadRequest, "invalid_limit", "Limit must be between 1 and 10.")
		return
	}
	results, err := runBraveSearch(r.Context(), s.searchAPIKey, request.Query, request.Limit)
	if err != nil {
		// Provider errors may contain the full query URL or other user supplied
		// content. Do not put them in logs.
		s.logger.Warn("search provider request failed", "request_id", requestIDFrom(r.Context()))
		writeError(w, http.StatusBadGateway, "search_provider_error", "The search provider request failed.")
		return
	}
	writeJSON(w, http.StatusOK, searchResponse{Query: request.Query, Results: results})
}

func (s *Server) requireToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(provided) != len(s.token) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "A valid companion bearer token is required.")
			return
		}
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(origin, "chrome-extension://") && len(strings.TrimPrefix(origin, "chrome-extension://")) > 0 {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
		}
		if r.Method == http.MethodOptions && strings.HasPrefix(origin, "chrome-extension://") {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if len(id) > 64 || strings.ContainsAny(id, "\r\n") {
			id = ""
		}
		if id == "" {
			id = time.Now().UTC().Format("20060102T150405.000000000Z")
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(withRequestID(r.Context(), id)))
	})
}

func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				s.logger.Error("request panic recovered", "request_id", requestIDFrom(r.Context()))
				writeError(w, http.StatusInternalServerError, "internal_error", "The request could not be completed.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type searchRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit,omitempty"`
}

type searchResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

type searchResponse struct {
	Query   string         `json:"query"`
	Results []searchResult `json:"results"`
}

type errorResponse struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: errorDetail{Code: code, Message: message}})
}
