package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

func runBraveSearch(ctx context.Context, key, query string, limit int) ([]searchResult, error) {
	endpoint, _ := url.Parse("https://api.search.brave.com/res/v1/web/search")
	params := endpoint.Query()
	params.Set("q", query)
	params.Set("count", strconv.Itoa(limit))
	endpoint.RawQuery = params.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Subscription-Token", key)

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// Never forward the provider credential to a redirect destination.
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("search provider returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, (2<<20)+1))
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("search provider returned an invalid response")
	}
	if len(payload.Web.Results) > limit {
		payload.Web.Results = payload.Web.Results[:limit]
	}
	results := make([]searchResult, 0, len(payload.Web.Results))
	for _, result := range payload.Web.Results {
		if result.URL == "" {
			continue
		}
		results = append(results, searchResult{Title: result.Title, URL: result.URL, Description: result.Description})
	}
	return results, nil
}
