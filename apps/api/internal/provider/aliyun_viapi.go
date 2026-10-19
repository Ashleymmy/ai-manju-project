package provider

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/ai-manju/api/internal/model"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

const (
	AliyunVIAPIPresetID              = "aliyun_viapi_super_resolution"
	AliyunAccessKeyIDSecret          = "aliyun_access_key_id"
	AliyunAccessKeySecretSecret      = "aliyun_access_key_secret"
	AliyunSecurityTokenSecret        = "aliyun_security_token"
	DefaultAliyunImageEnhanEndpoint  = "https://imageenhan.cn-shanghai.aliyuncs.com"
	DefaultAliyunVideoEnhanEndpoint  = "https://videoenhan.cn-shanghai.aliyuncs.com"
	DefaultAliyunVIAPIUtilsEndpoint  = "https://viapiutils.cn-shanghai.aliyuncs.com"
	DefaultAliyunImageEnhanVersion   = "2019-09-30"
	DefaultAliyunVideoEnhanVersion   = "2020-03-20"
	DefaultAliyunVIAPIUtilsVersion   = "2020-04-01"
	DefaultAliyunImageUpscaleAction  = "MakeSuperResolutionImage"
	DefaultAliyunVideoUpscaleAction  = "SuperResolveVideo"
	DefaultAliyunAsyncJobQueryAction = "GetAsyncJobResult"
	DefaultAliyunVIAPIRegion         = "cn-shanghai"
)

var (
	ErrImageUpscaleModelNotConfigured = errors.New("image upscale model is not configured; please contact an administrator")
	ErrVideoUpscaleModelNotConfigured = errors.New("video upscale model is not configured; please contact an administrator")
	ErrAliyunVIAPICredentialsMissing  = errors.New("aliyun VIAPI credentials (aliyun_access_key_id and aliyun_access_key_secret) or API key are not configured")
)

type AliyunVIAPICredentials struct {
	AccessKeyID     string
	AccessKeySecret string
	SecurityToken   string
}

func (c AliyunVIAPICredentials) HasAKSK() bool {
	return strings.TrimSpace(c.AccessKeyID) != "" && strings.TrimSpace(c.AccessKeySecret) != ""
}

func ExtractAliyunVIAPICredentials(secrets map[string]string) AliyunVIAPICredentials {
	return AliyunVIAPICredentials{
		AccessKeyID:     firstNonEmptyMapValue(secrets, AliyunAccessKeyIDSecret, "access_key_id", "access_key", "ak"),
		AccessKeySecret: firstNonEmptyMapValue(secrets, AliyunAccessKeySecretSecret, "access_key_secret", "secret_access_key", "secret_key", "sk"),
		SecurityToken:   firstNonEmptyMapValue(secrets, AliyunSecurityTokenSecret, "security_token", "sts_token"),
	}
}

func DefaultAliyunVIAPIEndpointOverrides() map[string]string {
	return map[string]string{
		"image_upscale_endpoint":     DefaultAliyunImageEnhanEndpoint,
		"image_upscale_action":       DefaultAliyunImageUpscaleAction,
		"image_upscale_version":      DefaultAliyunImageEnhanVersion,
		"video_upscale_endpoint":     DefaultAliyunVideoEnhanEndpoint,
		"video_upscale_action":       DefaultAliyunVideoUpscaleAction,
		"video_upscale_query_action": DefaultAliyunAsyncJobQueryAction,
		"video_upscale_version":      DefaultAliyunVideoEnhanVersion,
		"viapi_region":               DefaultAliyunVIAPIRegion,
	}
}

type ImageUpscaleRequest struct {
	Model         string `json:"model,omitempty"`
	URL           string `json:"url,omitempty"`
	ImageURL      string `json:"image_url,omitempty"`
	AssetID       string `json:"asset_id,omitempty"`
	DataURL       string `json:"data_url,omitempty"`
	Scope         string `json:"scope,omitempty"`
	Mode          string `json:"mode,omitempty"`
	UpscaleFactor int    `json:"upscale_factor,omitempty"`
	OutputFormat  string `json:"output_format,omitempty"`
	OutputQuality int    `json:"output_quality,omitempty"`
}

type ImageUpscaleResponse struct {
	RequestID     string `json:"request_id,omitempty"`
	URL           string `json:"url"`
	DataURL       string `json:"data_url,omitempty"`
	Model         string `json:"model,omitempty"`
	Mode          string `json:"mode"`
	UpscaleFactor int    `json:"upscale_factor"`
	OutputFormat  string `json:"output_format"`
	OutputQuality int    `json:"output_quality,omitempty"`
}

type VideoUpscaleRequest struct {
	Model    string `json:"model,omitempty"`
	VideoURL string `json:"video_url,omitempty"`
	URL      string `json:"url,omitempty"`
	AssetID  string `json:"asset_id,omitempty"`
	Scope    string `json:"scope,omitempty"`
	BitRate  int    `json:"bit_rate,omitempty"`
}

type VideoUpscaleTaskResponse struct {
	ID           string `json:"id"`
	JobID        string `json:"job_id"`
	RequestID    string `json:"request_id,omitempty"`
	Status       string `json:"status"`
	UpstreamCode string `json:"upstream_status,omitempty"`
	VideoURL     string `json:"video_url,omitempty"`
	Model        string `json:"model,omitempty"`
	BitRate      int    `json:"bit_rate,omitempty"`
	Message      string `json:"message,omitempty"`
	ErrorCode    string `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
}

func NormalizeImageUpscaleRequest(req ImageUpscaleRequest) (ImageUpscaleRequest, error) {
	sourceURL := strings.TrimSpace(req.URL)
	if sourceURL == "" {
		sourceURL = strings.TrimSpace(req.ImageURL)
	}
	if err := validateVIAPIMediaURL(sourceURL, "image url"); err != nil {
		return ImageUpscaleRequest{}, err
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "base"
	}
	if mode != "base" && mode != "enhancement" {
		return ImageUpscaleRequest{}, errors.New("mode must be base or enhancement")
	}
	factor := req.UpscaleFactor
	if factor == 0 {
		factor = 2
	}
	if factor < 1 || factor > 4 {
		return ImageUpscaleRequest{}, errors.New("upscale_factor must be between 1 and 4")
	}
	format := strings.ToLower(strings.TrimSpace(req.OutputFormat))
	if format == "jpeg" {
		format = "jpg"
	}
	if format == "" {
		format = "jpg"
	}
	if format != "png" && format != "jpg" && format != "bmp" {
		return ImageUpscaleRequest{}, errors.New("output_format must be png, jpg, or bmp")
	}
	quality := req.OutputQuality
	if format == "jpg" {
		if quality == 0 {
			quality = 95
		}
		if quality < 30 || quality > 100 {
			return ImageUpscaleRequest{}, errors.New("output_quality must be between 30 and 100")
		}
	} else {
		quality = 0
	}
	return ImageUpscaleRequest{
		Model:         strings.TrimSpace(req.Model),
		URL:           sourceURL,
		ImageURL:      sourceURL,
		Mode:          mode,
		UpscaleFactor: factor,
		OutputFormat:  format,
		OutputQuality: quality,
	}, nil
}

func NormalizeVideoUpscaleRequest(req VideoUpscaleRequest) (VideoUpscaleRequest, error) {
	sourceURL := strings.TrimSpace(req.VideoURL)
	if sourceURL == "" {
		sourceURL = strings.TrimSpace(req.URL)
	}
	if err := validateVIAPIMediaURL(sourceURL, "video_url"); err != nil {
		return VideoUpscaleRequest{}, err
	}
	bitRate := req.BitRate
	if bitRate == 0 {
		bitRate = 10
	}
	if bitRate < 1 || bitRate > 20 {
		return VideoUpscaleRequest{}, errors.New("bit_rate must be between 1 and 20")
	}
	return VideoUpscaleRequest{
		Model:    strings.TrimSpace(req.Model),
		VideoURL: sourceURL,
		URL:      sourceURL,
		BitRate:  bitRate,
	}, nil
}

func validateVIAPIMediaURL(rawURL string, fieldName string) error {
	if rawURL == "" {
		return fmt.Errorf("%s is required", fieldName)
	}
	for _, r := range rawURL {
		if unicode.Is(unicode.Han, r) {
			return fmt.Errorf("%s must not contain Chinese characters", fieldName)
		}
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("%s must be a valid HTTP(S) URL", fieldName)
	}
	return nil
}

func (c *OpenAICompatibleClient) UpscaleImage(ctx context.Context, req ImageUpscaleRequest, secrets map[string]string) (ImageUpscaleResponse, error) {
	normalized, err := NormalizeImageUpscaleRequest(req)
	if err != nil {
		return ImageUpscaleResponse{}, err
	}
	modelID := normalized.Model
	if modelID == "" {
		modelID = strings.TrimSpace(c.config.ImageUpscaleModel)
	}
	if modelID == "" {
		modelID = DefaultAliyunImageUpscaleAction
	}

	creds := ExtractAliyunVIAPICredentials(secrets)
	if creds.HasAKSK() || strings.TrimSpace(c.config.ProviderType) == model.ModelProviderTypeAliyunVIAPI {
		if !creds.HasAKSK() && strings.TrimSpace(c.apiKey) == "" {
			return ImageUpscaleResponse{}, ErrAliyunVIAPICredentialsMissing
		}
		if creds.HasAKSK() {
			return c.upscaleImageAliyunPOP(ctx, normalized, modelID, creds)
		}
	}
	return c.upscaleImageCompatibleGateway(ctx, normalized, modelID)
}

func (c *OpenAICompatibleClient) CreateVideoUpscaleTask(ctx context.Context, req VideoUpscaleRequest, secrets map[string]string) (VideoUpscaleTaskResponse, error) {
	normalized, err := NormalizeVideoUpscaleRequest(req)
	if err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	modelID := normalized.Model
	if modelID == "" {
		modelID = strings.TrimSpace(c.config.VideoUpscaleModel)
	}
	if modelID == "" {
		modelID = DefaultAliyunVideoUpscaleAction
	}

	creds := ExtractAliyunVIAPICredentials(secrets)
	if creds.HasAKSK() || strings.TrimSpace(c.config.ProviderType) == model.ModelProviderTypeAliyunVIAPI {
		if !creds.HasAKSK() && strings.TrimSpace(c.apiKey) == "" {
			return VideoUpscaleTaskResponse{}, ErrAliyunVIAPICredentialsMissing
		}
		if creds.HasAKSK() {
			return c.createVideoUpscaleAliyunPOP(ctx, normalized, modelID, creds)
		}
	}
	return c.createVideoUpscaleCompatibleGateway(ctx, normalized, modelID)
}

func (c *OpenAICompatibleClient) GetVideoUpscaleTask(ctx context.Context, jobID string, modelID string, secrets map[string]string) (VideoUpscaleTaskResponse, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return VideoUpscaleTaskResponse{}, errors.New("job_id is required")
	}
	if strings.TrimSpace(modelID) == "" {
		modelID = strings.TrimSpace(c.config.VideoUpscaleModel)
	}
	if modelID == "" {
		modelID = DefaultAliyunVideoUpscaleAction
	}

	creds := ExtractAliyunVIAPICredentials(secrets)
	if creds.HasAKSK() || strings.TrimSpace(c.config.ProviderType) == model.ModelProviderTypeAliyunVIAPI {
		if !creds.HasAKSK() && strings.TrimSpace(c.apiKey) == "" {
			return VideoUpscaleTaskResponse{}, ErrAliyunVIAPICredentialsMissing
		}
		if creds.HasAKSK() {
			return c.getVideoUpscaleAliyunPOP(ctx, jobID, modelID, creds)
		}
	}
	return c.getVideoUpscaleCompatibleGateway(ctx, jobID, modelID)
}

func (c *OpenAICompatibleClient) upscaleImageAliyunPOP(
	ctx context.Context,
	req ImageUpscaleRequest,
	modelID string,
	creds AliyunVIAPICredentials,
) (ImageUpscaleResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["image_upscale_endpoint"], DefaultAliyunImageEnhanEndpoint)
	if baseURL := strings.TrimRight(strings.TrimSpace(c.config.BaseURL), "/"); overrides["image_upscale_endpoint"] == "" && strings.Contains(strings.ToLower(baseURL), "imageenhan.") {
		endpoint = baseURL
	}
	version := firstNonEmpty(overrides["image_upscale_version"], DefaultAliyunImageEnhanVersion)
	action := firstNonEmpty(overrides["image_upscale_action"], DefaultAliyunImageUpscaleAction)

	params := map[string]string{
		"Url":           req.URL,
		"Mode":          req.Mode,
		"UpscaleFactor": strconv.Itoa(req.UpscaleFactor),
		"OutputFormat":  req.OutputFormat,
	}
	if req.OutputFormat == "jpg" && req.OutputQuality > 0 {
		params["OutputQuality"] = strconv.Itoa(req.OutputQuality)
	}

	raw, err := c.doAliyunPOPRequest(ctx, endpoint, version, action, params, creds)
	if err != nil {
		return ImageUpscaleResponse{}, err
	}
	var payload struct {
		RequestID string `json:"RequestId"`
		Data      struct {
			URL string `json:"Url"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ImageUpscaleResponse{}, fmt.Errorf("invalid MakeSuperResolutionImage response: %w", err)
	}
	resultURL := strings.TrimSpace(payload.Data.URL)
	if resultURL == "" {
		return ImageUpscaleResponse{}, errors.New("MakeSuperResolutionImage response did not include Data.Url")
	}
	return ImageUpscaleResponse{
		RequestID:     strings.TrimSpace(payload.RequestID),
		URL:           resultURL,
		Model:         modelID,
		Mode:          req.Mode,
		UpscaleFactor: req.UpscaleFactor,
		OutputFormat:  req.OutputFormat,
		OutputQuality: req.OutputQuality,
	}, nil
}

func (c *OpenAICompatibleClient) createVideoUpscaleAliyunPOP(
	ctx context.Context,
	req VideoUpscaleRequest,
	modelID string,
	creds AliyunVIAPICredentials,
) (VideoUpscaleTaskResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := resolveAliyunVideoEnhanEndpoint(c.config.BaseURL, overrides["video_upscale_endpoint"])
	version := firstNonEmpty(overrides["video_upscale_version"], DefaultAliyunVideoEnhanVersion)
	action := firstNonEmpty(overrides["video_upscale_action"], DefaultAliyunVideoUpscaleAction)

	params := map[string]string{
		"VideoUrl": req.VideoURL,
		"BitRate":  strconv.Itoa(req.BitRate),
	}
	raw, err := c.doAliyunPOPRequest(ctx, endpoint, version, action, params, creds)
	if err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	var payload struct {
		RequestID string `json:"RequestId"`
		Message   string `json:"Message"`
		Data      struct {
			JobID string `json:"JobId"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return VideoUpscaleTaskResponse{}, fmt.Errorf("invalid SuperResolveVideo response: %w", err)
	}
	jobID := firstNonEmpty(payload.Data.JobID, payload.RequestID)
	if jobID == "" {
		return VideoUpscaleTaskResponse{}, errors.New("SuperResolveVideo response did not include RequestId or JobId")
	}
	return VideoUpscaleTaskResponse{
		ID:           jobID,
		JobID:        jobID,
		RequestID:    strings.TrimSpace(payload.RequestID),
		Status:       "processing",
		UpstreamCode: "PROCESSING",
		Model:        modelID,
		BitRate:      req.BitRate,
		Message:      strings.TrimSpace(payload.Message),
	}, nil
}

func (c *OpenAICompatibleClient) getVideoUpscaleAliyunPOP(
	ctx context.Context,
	jobID string,
	modelID string,
	creds AliyunVIAPICredentials,
) (VideoUpscaleTaskResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := resolveAliyunVideoEnhanEndpoint(c.config.BaseURL, overrides["video_upscale_endpoint"])
	version := firstNonEmpty(overrides["video_upscale_version"], DefaultAliyunVideoEnhanVersion)
	action := firstNonEmpty(overrides["video_upscale_query_action"], DefaultAliyunAsyncJobQueryAction)

	params := map[string]string{
		"JobId": jobID,
	}
	raw, err := c.doAliyunPOPRequest(ctx, endpoint, version, action, params, creds)
	if err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	return parseAliyunAsyncJobResponse(raw, jobID, modelID)
}

func parseAliyunAsyncJobResponse(raw []byte, fallbackJobID string, modelID string) (VideoUpscaleTaskResponse, error) {
	var payload struct {
		RequestID string `json:"RequestId"`
		Data      struct {
			JobID        string `json:"JobId"`
			Status       string `json:"Status"`
			Result       string `json:"Result"`
			ErrorCode    string `json:"ErrorCode"`
			ErrorMessage string `json:"ErrorMessage"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return VideoUpscaleTaskResponse{}, fmt.Errorf("invalid GetAsyncJobResult response: %w", err)
	}
	resolvedJobID := firstNonEmpty(payload.Data.JobID, fallbackJobID)
	upstreamStatus := strings.TrimSpace(payload.Data.Status)
	normalizedStatus := normalizeAliyunAsyncJobStatus(upstreamStatus)

	videoURL := ""
	if trimmedResult := strings.TrimSpace(payload.Data.Result); trimmedResult != "" {
		var resultObj map[string]any
		if err := json.Unmarshal([]byte(trimmedResult), &resultObj); err == nil {
			videoURL = firstNonEmpty(
				stringValue(resultObj["VideoUrl"]),
				stringValue(resultObj["video_url"]),
				stringValue(resultObj["Url"]),
				stringValue(resultObj["url"]),
			)
		}
	}

	return VideoUpscaleTaskResponse{
		ID:           resolvedJobID,
		JobID:        resolvedJobID,
		RequestID:    strings.TrimSpace(payload.RequestID),
		Status:       normalizedStatus,
		UpstreamCode: upstreamStatus,
		VideoURL:     videoURL,
		Model:        modelID,
		ErrorCode:    strings.TrimSpace(payload.Data.ErrorCode),
		ErrorMessage: strings.TrimSpace(payload.Data.ErrorMessage),
	}, nil
}

func normalizeAliyunAsyncJobStatus(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PROCESS_SUCCESS", "SUCCEEDED", "SUCCESS":
		return "succeeded"
	case "PROCESS_FAILED", "FAILED", "ERROR":
		return "failed"
	case "QUEUING", "QUEUED", "PENDING":
		return "queued"
	default:
		return "processing"
	}
}

func resolveAliyunVideoEnhanEndpoint(baseURL string, override string) string {
	if strings.TrimSpace(override) != "" {
		return strings.TrimRight(strings.TrimSpace(override), "/")
	}
	trimmedBase := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmedBase == "" || strings.Contains(strings.ToLower(trimmedBase), "imageenhan.") {
		return DefaultAliyunVideoEnhanEndpoint
	}
	return trimmedBase
}

func (c *OpenAICompatibleClient) doAliyunPOPRequest(
	ctx context.Context,
	endpoint string,
	version string,
	action string,
	businessParams map[string]string,
	creds AliyunVIAPICredentials,
) ([]byte, error) {
	// Official SDK clients always send RegionId; VIAPI only runs in Shanghai.
	params := map[string]string{"RegionId": firstNonEmpty(endpointOverridesFromConfig(c.config)["viapi_region"], DefaultAliyunVIAPIRegion)}
	for key, value := range businessParams {
		params[key] = value
	}
	allParams := BuildAliyunPOPSignedParams(
		http.MethodPost,
		version,
		action,
		params,
		creds,
		time.Now().UTC(),
		randomPOPNonce(),
	)
	formBody := encodePOPFormValues(allParams)
	targetURL := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, strings.NewReader(formBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
	req.Header.Set("Accept", "application/json")
	for key, value := range extraHeadersFromConfig(c.config) {
		req.Header.Set(key, value)
	}

	resp, err := c.longClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ProviderHTTPError{
			RequestID:  resp.Header.Get("x-acs-request-id"),
			Method:     http.MethodPost,
			URL:        targetURL,
			StatusCode: resp.StatusCode,
			Body:       string(body),
		}
	}
	var errCheck struct {
		Code      string `json:"Code"`
		Message   string `json:"Message"`
		RequestID string `json:"RequestId"`
	}
	if err := json.Unmarshal(body, &errCheck); err == nil {
		code := strings.TrimSpace(errCheck.Code)
		if code != "" && code != "0" && !strings.EqualFold(code, "Success") && !strings.EqualFold(code, "OK") {
			return nil, &ProviderHTTPError{
				RequestID:  strings.TrimSpace(errCheck.RequestID),
				Method:     http.MethodPost,
				URL:        targetURL,
				StatusCode: http.StatusBadGateway,
				Body:       string(body),
			}
		}
	}
	return body, nil
}

// BuildAliyunPOPSignedParams constructs and signs Alibaba Cloud RPC (POP v1 HMAC-SHA1) parameters.
func BuildAliyunPOPSignedParams(
	httpMethod string,
	version string,
	action string,
	businessParams map[string]string,
	creds AliyunVIAPICredentials,
	timestamp time.Time,
	nonce string,
) map[string]string {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          strings.TrimSpace(version),
		"AccessKeyId":      strings.TrimSpace(creds.AccessKeyID),
		"SignatureMethod":  "HMAC-SHA1",
		"Timestamp":        timestamp.UTC().Format("2006-01-02T15:04:05Z"),
		"SignatureVersion": "1.0",
		"SignatureNonce":   strings.TrimSpace(nonce),
		"Action":           strings.TrimSpace(action),
	}
	if token := strings.TrimSpace(creds.SecurityToken); token != "" {
		params["SecurityToken"] = token
	}
	for k, v := range businessParams {
		if strings.TrimSpace(k) != "" && strings.TrimSpace(v) != "" {
			params[k] = v
		}
	}
	params["Signature"] = SignAliyunPOPParams(httpMethod, params, creds.AccessKeySecret)
	return params
}

// SignAliyunPOPParams computes the Alibaba Cloud RPC Signature (HMAC-SHA1 over RFC3986 canonical query string).
func SignAliyunPOPParams(httpMethod string, params map[string]string, accessKeySecret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "Signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, popPercentEncode(k)+"="+popPercentEncode(params[k]))
	}
	canonicalizedQuery := strings.Join(pairs, "&")
	stringToSign := strings.ToUpper(strings.TrimSpace(httpMethod)) + "&" + popPercentEncode("/") + "&" + popPercentEncode(canonicalizedQuery)

	mac := hmac.New(sha1.New, []byte(strings.TrimSpace(accessKeySecret)+"&"))
	mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func popPercentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

func encodePOPFormValues(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, popPercentEncode(k)+"="+popPercentEncode(params[k]))
	}
	return strings.Join(pairs, "&")
}

func randomPOPNonce() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return hex.EncodeToString(buf[:])
}

func (c *OpenAICompatibleClient) upscaleImageCompatibleGateway(
	ctx context.Context,
	req ImageUpscaleRequest,
	modelID string,
) (ImageUpscaleResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["image_upscale"], overrides["image_upscale_endpoint"], "/v1/images/upscale")
	targetURL := resolveEndpointURL(c.config.BaseURL, endpoint)
	bodyMap := map[string]any{
		"model":          modelID,
		"url":            req.URL,
		"image_url":      req.URL,
		"mode":           req.Mode,
		"upscale_factor": req.UpscaleFactor,
		"output_format":  req.OutputFormat,
	}
	if req.OutputFormat == "jpg" && req.OutputQuality > 0 {
		bodyMap["output_quality"] = req.OutputQuality
	}
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, bodyMap)
	if err != nil {
		return ImageUpscaleResponse{}, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ImageUpscaleResponse{}, err
	}
	dataMap, _ := parsed["Data"].(map[string]any)
	if dataMap == nil {
		dataMap, _ = parsed["data"].(map[string]any)
	}
	resultURL := firstNonEmpty(
		stringValue(parsed["url"]),
		stringValue(parsed["Url"]),
		stringValue(dataMap["Url"]),
		stringValue(dataMap["url"]),
	)
	if resultURL == "" {
		if list, ok := parsed["data"].([]any); ok && len(list) > 0 {
			if firstItem, ok := list[0].(map[string]any); ok {
				resultURL = firstNonEmpty(stringValue(firstItem["url"]), stringValue(firstItem["Url"]))
			}
		}
	}
	if resultURL == "" {
		return ImageUpscaleResponse{}, errors.New("upscale response did not include a result URL")
	}
	return ImageUpscaleResponse{
		RequestID:     firstNonEmpty(stringValue(parsed["request_id"]), stringValue(parsed["RequestId"])),
		URL:           resultURL,
		Model:         modelID,
		Mode:          req.Mode,
		UpscaleFactor: req.UpscaleFactor,
		OutputFormat:  req.OutputFormat,
		OutputQuality: req.OutputQuality,
	}, nil
}

func (c *OpenAICompatibleClient) createVideoUpscaleCompatibleGateway(
	ctx context.Context,
	req VideoUpscaleRequest,
	modelID string,
) (VideoUpscaleTaskResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpoint := firstNonEmpty(overrides["video_upscale"], overrides["video_upscale_endpoint"], "/v1/videos/upscale")
	targetURL := resolveEndpointURL(c.config.BaseURL, endpoint)
	bodyMap := map[string]any{
		"model":     modelID,
		"video_url": req.VideoURL,
		"url":       req.VideoURL,
		"bit_rate":  req.BitRate,
	}
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodPost, targetURL, bodyMap)
	if err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	dataMap, _ := parsed["Data"].(map[string]any)
	if dataMap == nil {
		dataMap, _ = parsed["data"].(map[string]any)
	}
	jobID := firstNonEmpty(
		stringValue(parsed["id"]),
		stringValue(parsed["job_id"]),
		stringValue(parsed["RequestId"]),
		stringValue(parsed["request_id"]),
		stringValue(dataMap["JobId"]),
		stringValue(dataMap["job_id"]),
	)
	if jobID == "" {
		return VideoUpscaleTaskResponse{}, errors.New("video upscale response did not include job_id or RequestId")
	}
	videoURL := firstNonEmpty(stringValue(parsed["video_url"]), stringValue(dataMap["video_url"]), stringValue(dataMap["VideoUrl"]))
	status := normalizeAliyunAsyncJobStatus(firstNonEmpty(stringValue(parsed["status"]), stringValue(dataMap["Status"]), "PROCESSING"))
	if videoURL != "" && status == "processing" {
		status = "succeeded"
	}
	return VideoUpscaleTaskResponse{
		ID:        jobID,
		JobID:     jobID,
		RequestID: firstNonEmpty(stringValue(parsed["RequestId"]), stringValue(parsed["request_id"]), jobID),
		Status:    status,
		VideoURL:  videoURL,
		Model:     modelID,
		BitRate:   req.BitRate,
		Message:   firstNonEmpty(stringValue(parsed["Message"]), stringValue(parsed["message"])),
	}, nil
}

func (c *OpenAICompatibleClient) getVideoUpscaleCompatibleGateway(
	ctx context.Context,
	jobID string,
	modelID string,
) (VideoUpscaleTaskResponse, error) {
	overrides := endpointOverridesFromConfig(c.config)
	endpointTemplate := firstNonEmpty(overrides["video_upscale_get"], "/v1/videos/upscale/{id}")
	endpoint := strings.ReplaceAll(endpointTemplate, "{id}", url.PathEscape(jobID))
	targetURL := resolveEndpointURL(c.config.BaseURL, endpoint)
	raw, err := c.doCompatibleJSONRequest(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	if resp, err := parseAliyunAsyncJobResponse(raw, jobID, modelID); err == nil && (resp.UpstreamCode != "" || resp.VideoURL != "") {
		return resp, nil
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return VideoUpscaleTaskResponse{}, err
	}
	videoURL := firstNonEmpty(stringValue(parsed["video_url"]), stringValue(parsed["url"]))
	status := normalizeAliyunAsyncJobStatus(firstNonEmpty(stringValue(parsed["status"]), "PROCESSING"))
	return VideoUpscaleTaskResponse{
		ID:           jobID,
		JobID:        jobID,
		RequestID:    firstNonEmpty(stringValue(parsed["request_id"]), stringValue(parsed["RequestId"])),
		Status:       status,
		VideoURL:     videoURL,
		Model:        modelID,
		ErrorMessage: stringValue(parsed["error_message"]),
	}, nil
}

func (c *OpenAICompatibleClient) doCompatibleJSONRequest(
	ctx context.Context,
	method string,
	targetURL string,
	body any,
) ([]byte, error) {
	return c.doCompatibleJSONRequestWithHeaders(ctx, method, targetURL, body, nil)
}

func (c *OpenAICompatibleClient) doCompatibleJSONRequestWithHeaders(
	ctx context.Context,
	method string,
	targetURL string,
	body any,
	headers map[string]string,
) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	reqURL := c.applyAuthQueryParam(targetURL)
	req, err := http.NewRequestWithContext(ctx, method, reqURL, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	c.applyAuthHeaders(req)
	c.applyExtraHeaders(req)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := c.longClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ProviderHTTPError{
			Method:     method,
			URL:        targetURL,
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}
	return respBody, nil
}

func resolveEndpointURL(baseURL string, endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint
	}
	return strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/" + strings.TrimLeft(endpoint, "/")
}

func endpointOverridesFromConfig(config model.ModelProviderConfig) map[string]string {
	result := make(map[string]string)
	if len(config.EndpointOverrides) == 0 {
		return result
	}
	_ = json.Unmarshal(config.EndpointOverrides, &result)
	return result
}

func extraHeadersFromConfig(config model.ModelProviderConfig) map[string]string {
	result := make(map[string]string)
	if len(config.ExtraHeaders) == 0 {
		return result
	}
	_ = json.Unmarshal(config.ExtraHeaders, &result)
	return result
}

func firstNonEmptyMapValue(values map[string]string, keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(values[key]); v != "" {
			return v
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

// UploadMediaToVIAPITempOSS stages a local media stream to Alibaba Cloud VIAPI's official
// temporary OSS bucket (viapi-customer-temp in oss-cn-shanghai) via GetOssStsToken so that
// local/workspace assets without public URLs can be processed by MakeSuperResolutionImage / SuperResolveVideo.
func (c *OpenAICompatibleClient) UploadMediaToVIAPITempOSS(
	ctx context.Context,
	reader io.Reader,
	ext string,
	secrets map[string]string,
) (string, error) {
	creds := ExtractAliyunVIAPICredentials(secrets)
	if !creds.HasAKSK() {
		return "", ErrAliyunVIAPICredentialsMissing
	}
	overrides := endpointOverridesFromConfig(c.config)
	utilsEndpoint := firstNonEmpty(overrides["viapi_utils_endpoint"], DefaultAliyunVIAPIUtilsEndpoint)
	raw, err := c.doAliyunPOPRequest(ctx, utilsEndpoint, DefaultAliyunVIAPIUtilsVersion, "GetOssStsToken", nil, creds)
	if err != nil {
		return "", fmt.Errorf("viapi GetOssStsToken failed: %w", err)
	}
	var tokenResp struct {
		Data struct {
			AccessKeyID     string `json:"AccessKeyId"`
			AccessKeySecret string `json:"AccessKeySecret"`
			SecurityToken   string `json:"SecurityToken"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &tokenResp); err != nil {
		return "", fmt.Errorf("invalid GetOssStsToken response: %w", err)
	}
	if strings.TrimSpace(tokenResp.Data.AccessKeyID) == "" || strings.TrimSpace(tokenResp.Data.AccessKeySecret) == "" {
		return "", errors.New("GetOssStsToken returned empty STS credentials")
	}

	ossClient, err := oss.New(
		"https://oss-cn-shanghai.aliyuncs.com",
		strings.TrimSpace(tokenResp.Data.AccessKeyID),
		strings.TrimSpace(tokenResp.Data.AccessKeySecret),
		oss.SecurityToken(strings.TrimSpace(tokenResp.Data.SecurityToken)),
		oss.Timeout(10, 300),
	)
	if err != nil {
		return "", fmt.Errorf("cannot initialize VIAPI temp OSS client: %w", err)
	}
	bucket, err := ossClient.Bucket("viapi-customer-temp")
	if err != nil {
		return "", fmt.Errorf("cannot open VIAPI temp OSS bucket: %w", err)
	}
	cleanExt := strings.TrimSpace(ext)
	if cleanExt == "" {
		cleanExt = ".bin"
	} else if !strings.HasPrefix(cleanExt, ".") {
		cleanExt = "." + cleanExt
	}
	// The STS policy only allows keys under the caller's own AccessKey ID (as in Alibaba Cloud's viapi-utils).
	objectKey := strings.TrimSpace(creds.AccessKeyID) + "/" + randomPOPNonce() + cleanExt
	if err := bucket.PutObject(objectKey, reader, oss.WithContext(ctx)); err != nil {
		return "", fmt.Errorf("upload to VIAPI temp OSS failed: %w", err)
	}
	return "http://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/" + objectKey, nil
}

func (c *OpenAICompatibleClient) DownloadMediaBytes(ctx context.Context, mediaURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(mediaURL), nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.mediaClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("download media failed with status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderBinaryResponseBytes))
	if err != nil {
		return nil, "", err
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	return data, contentType, nil
}
