package handler

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// Bound the persisted per-user archive organization without silently dropping groups.
const (
	maxProjectGroups     = 100
	maxProjectGroupTitle = 80
	maxProjectGroupID    = 128
	maxGroupedProjects   = 10000
)

func validateProjectGroups(value any) error {
	invalid := errors.New("项目分组数据无效或超出限制")
	scopes, ok := value.(map[string]any)
	if !ok {
		return invalid
	}
	for scope, raw := range scopes {
		if scope != "personal" && scope != "team" {
			return invalid
		}
		groups, ok := raw.([]any)
		if !ok || len(groups) > maxProjectGroups {
			return invalid
		}
		ids, projects := map[string]bool{}, map[string]bool{}
		for _, rawGroup := range groups {
			group, ok := rawGroup.(map[string]any)
			if !ok || len(group) != 3 {
				return invalid
			}
			id, idOK := group["id"].(string)
			title, titleOK := group["title"].(string)
			members, membersOK := group["projectIds"].([]any)
			if !idOK || strings.TrimSpace(id) == "" || len(id) > maxProjectGroupID || ids[id] || !titleOK || strings.TrimSpace(title) == "" || utf8.RuneCountInString(title) > maxProjectGroupTitle || !membersOK {
				return invalid
			}
			ids[id] = true
			for _, member := range members {
				projectID, ok := member.(string)
				if !ok || strings.TrimSpace(projectID) == "" || len(projectID) > maxProjectGroupID || projects[projectID] {
					return invalid
				}
				projects[projectID] = true
				if len(projects) > maxGroupedProjects {
					return invalid
				}
			}
		}
	}
	return nil
}
