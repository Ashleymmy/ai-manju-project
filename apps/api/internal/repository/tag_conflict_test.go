package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestTagConflictKeepsDatabaseCauseAndRejectsUnrelatedConstraints(t *testing.T) {
	for _, constraint := range []string{"idx_tag_scope_parent_name", "idx_tag_alias_name", "tags_pkey", "legacy_global_tag_name"} {
		t.Run(constraint, func(t *testing.T) {
			cause := &pgconn.PgError{Code: "23505", ConstraintName: constraint, Detail: "private row values"}
			err := mapTagConflict(fmt.Errorf("create: %w", cause))
			wantConflict := constraint == "idx_tag_scope_parent_name" || constraint == "idx_tag_alias_name"
			if errors.Is(err, ErrTagConflict) != wantConflict {
				t.Fatalf("wrong conflict classification: %v", err)
			}
			var actual *pgconn.PgError
			if !errors.As(err, &actual) || actual != cause {
				t.Fatal("lost database diagnostics")
			}
			if wantConflict && err.Error() != ErrTagConflict.Error() {
				t.Fatal("public conflict text changed")
			}
		})
	}
	if mapTagConflict(nil) != nil {
		t.Fatal("nil error changed")
	}
	err := &pgconn.PgError{Code: "23503", ConstraintName: "idx_tag_scope_parent_name"}
	if mapTagConflict(err) != err {
		t.Fatal("foreign-key error treated as a duplicate")
	}
}
