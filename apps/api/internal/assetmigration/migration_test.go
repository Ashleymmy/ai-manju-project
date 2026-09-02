package assetmigration

import (
	"reflect"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestCollectJobResultAssetIDsOnlyAcceptsRegisteredAssetIDs(t *testing.T) {
	result := model.JSONB(`{
		"assets":[{"id":"asset_alpha"},{"asset_id":"asset_beta"}],
		"outputs":[{"asset_id":"asset_alpha"},{"id":"provider-file-1"}],
		"nested":{"items":[{"id":"asset_gamma"}]}
	}`)
	want := []string{"asset_alpha", "asset_beta", "asset_gamma"}
	if got := collectJobResultAssetIDs(result); !reflect.DeepEqual(got, want) {
		t.Fatalf("asset ids = %v, want %v", got, want)
	}
	if got := collectJobResultAssetIDs(model.JSONB(`not-json`)); len(got) != 0 {
		t.Fatalf("invalid result ids = %v", got)
	}
}

func TestEffectiveWorkspaceIDPreservesTeamAndBackfillsPersonal(t *testing.T) {
	if got := effectiveWorkspaceID("team:default", "user_a"); got != "team:default" {
		t.Fatalf("team workspace = %q", got)
	}
	if got := effectiveWorkspaceID("", "user_a"); got != "default:user_a" {
		t.Fatalf("personal workspace = %q", got)
	}
}
