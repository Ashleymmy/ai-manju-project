package service

import "strings"

const (
	WorkspaceScopePersonal = "personal"
	WorkspaceScopeTeam     = "team"
	TeamWorkspaceID        = "team:default"
)

func NormalizeWorkspaceScope(scope string) string {
	if strings.TrimSpace(strings.ToLower(scope)) == WorkspaceScopeTeam {
		return WorkspaceScopeTeam
	}
	return WorkspaceScopePersonal
}

func WorkspaceIDForScope(scope string, userID string) string {
	if NormalizeWorkspaceScope(scope) == WorkspaceScopeTeam {
		return TeamWorkspaceID
	}
	return "default:" + userID
}

func WorkspaceScopeFromID(workspaceID string) string {
	if workspaceID == TeamWorkspaceID {
		return WorkspaceScopeTeam
	}
	return WorkspaceScopePersonal
}
