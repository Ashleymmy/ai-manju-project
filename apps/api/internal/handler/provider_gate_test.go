package handler

import (
	"strings"
	"testing"
)

func TestProviderGateFingerprintNormalizesBaseURL(t *testing.T) {
	first := providerGateFingerprint("application-secret", "HTTPS://Provider.Example:443/v1/", " api-key ")
	second := providerGateFingerprint("application-secret", "https://provider.example/v1", "api-key")
	if first == "" || first != second {
		t.Fatalf("normalized fingerprints differ: %q != %q", first, second)
	}
	if strings.Contains(first, "api-key") || strings.Contains(first, "provider.example") {
		t.Fatalf("fingerprint leaked credential material: %q", first)
	}
}

func TestProviderGateFingerprintSeparatesCredentials(t *testing.T) {
	first := providerGateFingerprint("application-secret", "https://provider.example/v1", "api-key-a")
	second := providerGateFingerprint("application-secret", "https://provider.example/v1", "api-key-b")
	if first == second {
		t.Fatal("different API keys must not share a Provider gate")
	}
}

func TestClampProviderConcurrency(t *testing.T) {
	for input, want := range map[int]int{-1: 1, 0: 3, 1: 1, 4: 4, 8: 8, 9: 8} {
		if got := clampProviderConcurrency(input); got != want {
			t.Fatalf("clampProviderConcurrency(%d) = %d, want %d", input, got, want)
		}
	}
}
