package service

import (
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
	"github.com/ai-manju/api/internal/repository"
)

// [画布别名]
func TestCanvasModelNicknamesLoadSavedTableAndIgnoreInvalidConfig(t *testing.T) {
	billing := repository.NewMemoryBillingRepository()
	if got := LoadCanvasModelNicknames(billing); len(got) != 0 {
		t.Fatalf("missing config = %v, want empty", got)
	}
	if err := billing.UpsertConfig(model.BillingConfigKeyCanvasNicknames, model.JSONB(`{"gpt-image-2":"image2"}`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := LoadCanvasModelNicknames(billing); got["gpt-image-2"] != "image2" {
		t.Fatalf("saved nicknames = %v", got)
	}
	if err := billing.UpsertConfig(model.BillingConfigKeyCanvasNicknames, model.JSONB(`["broken"]`), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := LoadCanvasModelNicknames(billing); len(got) != 0 {
		t.Fatalf("invalid config = %v, want empty", got)
	}
}

func TestParseCanvasModelNicknamesRejectsSelectorsAndBlankNames(t *testing.T) {
	for _, raw := range []string{`null`, `{"p::gpt-image-2":"image2"}`, `{" gpt-image-2":"image2"}`, `{"gpt-image-2":""}`, `{"gpt-image-2":" image2"}`} {
		if _, err := ParseCanvasModelNicknames([]byte(raw)); err == nil {
			t.Fatalf("%s accepted", raw)
		}
	}
	if got, err := ParseCanvasModelNicknames([]byte(`{"sdvideo/seedance-2.0":"sd2.0"}`)); err != nil || got["sdvideo/seedance-2.0"] != "sd2.0" {
		t.Fatalf("valid nicknames = %v, %v", got, err)
	}
}
