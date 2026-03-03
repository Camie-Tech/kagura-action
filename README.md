# Kagura AI GitHub Action

Trigger Kagura AI test runs from GitHub Actions.

## Inputs

- `api-key` (**required**) — Kagura API key (e.g. `kag_live_...`)
- `target-url` (optional) — override target URL
- `test-group` (optional) — test group ID (uuid)
- `test-ids` (optional) — comma-separated test IDs (uuid1,uuid2)
- `wait-for-results` (default `true`) — poll status/results and fail workflow if tests fail
- `poll-interval-seconds` (default `15`)
- `timeout-minutes` (default `60`)

## Example

```yaml
- name: Run Kagura tests
  uses: kagura-ai/kagura-action@v1
  with:
    api-key: ${{ secrets.KAGURA_API_KEY }}
    test-group: "<your-test-group-uuid>"
    target-url: "https://staging.yourapp.com"
    wait-for-results: true
```

> Note: `@v1` will be available after the first release tag is created.
