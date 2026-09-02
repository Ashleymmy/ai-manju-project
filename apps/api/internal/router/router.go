package router

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ai-manju/api/internal/auth"
	"github.com/ai-manju/api/internal/config"
	"github.com/ai-manju/api/internal/database"
	"github.com/ai-manju/api/internal/handler"
	"github.com/ai-manju/api/internal/middleware"
	"github.com/ai-manju/api/internal/provider"
	"github.com/ai-manju/api/internal/queue"
	"github.com/ai-manju/api/internal/repository"
	"github.com/ai-manju/api/internal/response"
	"github.com/ai-manju/api/internal/service"
	"github.com/ai-manju/api/internal/storage"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

var corsAllowedHeaders = []string{
	"Origin",
	"Content-Type",
	"Authorization",
	"Idempotency-Key",
	middleware.RequestIDHeader,
	"X-Webdav-Target",
	"X-Webdav-Method",
	"X-Webdav-Authorization",
	"X-Webdav-Depth",
	"X-Webdav-Destination",
	"X-Webdav-Overwrite",
	"X-Webdav-Content-Type",
}

func New() *gin.Engine {
	cfg := config.Load()
	return NewWithConfig(cfg)
}

func NewWithConfig(cfg config.Config) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.RequestID())
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Expose-Headers", middleware.RequestIDHeader)
		c.Next()
	})

	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.FrontendURLs,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     corsAllowedHeaders,
		ExposeHeaders:    []string{middleware.RequestIDHeader},
		AllowCredentials: true,
	}))

	repos, storageStatus, dbStatus := newRepositories(cfg)
	authService := auth.NewService(repos.userRepo, cfg)
	if err := authService.SeedSuperAdmin(cfg); err != nil {
		log.Printf("super admin seed failed: %v", err)
	}

	projectService := service.NewProjectService(repos.projectRepo)
	projectService.SetAssetReferenceRepository(repos.assetReferenceRepo)
	assetStore := storage.NewLocalFSStorage(cfg.AssetStorageDir)
	jobInputService := service.NewJobInputService(assetStore, cfg.MaxAssetUploadBytes)
	jobService := service.NewJobService(
		repos.jobRepo,
		queue.NewCeleryRedisProducer(cfg.CeleryBrokerURL, cfg.CeleryQueueName),
		cfg.CeleryQueueName,
		cfg.JobMaxAttempts,
	)
	jobService.SetJobInputService(jobInputService)

	projectHandler := handler.NewProjectHandlerWithService(projectService)
	authHandler := handler.NewAuthHandler(authService, repos.userRepo, cfg)
	secretBox := provider.NewSecretBox(cfg.AppSecret)
	assetService := service.NewAssetService(repos.assetRepo, assetStore)
	assetService.SetReferenceRepository(repos.assetReferenceRepo)
	assetFolderService := service.NewAssetFolderService(repos.assetFolderRepo, repos.assetRepo)
	if err := assetFolderService.SetArchiveTimezone(cfg.AssetArchiveTimezone); err != nil {
		panic(fmt.Sprintf("invalid ASSET_ARCHIVE_TIMEZONE: %v", err))
	}
	assetFolderService.SetActiveReferenceChecker(repos.comicAssetRepo)
	assetService.SetFolderService(assetFolderService)
	tagService := service.NewTagService(repos.tagRepo, repos.assetRepo)
	assetService.SetTagSyncer(tagService)
	assetService.SetTagFilterer(tagService)
	assetLineageService := service.NewAssetLineageService(repos.assetLineageRepo, repos.assetRepo, repos.tagRepo)
	assetService.SetLineageService(assetLineageService)
	assetUsageService := service.NewAssetUsageService(repos.assetUsageRepo, repos.assetRepo, repos.assetReferenceRepo, repos.assetLineageRepo)
	assetService.SetUsageFilterer(assetUsageService)
	jobService.SetAssetUsageRecorder(assetUsageService)
	projectService.SetAssetUsageRecorder(assetUsageService)
	assetService.StartTrashMaintenance(context.Background(), service.AssetTrashMaintenanceInterval)
	assetHandler := handler.NewAssetHandlerWithService(assetService, cfg)
	assetHandler.SetLineageService(assetLineageService)
	assetHandler.SetUsageService(assetUsageService)
	assetFolderHandler := handler.NewAssetFolderHandler(assetFolderService)
	tagHandler := handler.NewTagHandler(tagService)
	assetExportService := service.NewAssetExportService(repos.assetExportRepo, assetService, assetFolderService, assetStore)
	assetExportService.SetAssetUsageRecorder(assetUsageService)
	// Memory mode has no cross-process persistence, so development dispatches in
	// the API. PostgreSQL deployments use the dedicated asset-export worker.
	if cfg.StorageDriver != "postgres" {
		assetExportService.StartDispatcher(context.Background(), service.AssetExportDispatchInterval)
	}
	assetExportHandler := handler.NewAssetExportHandler(assetExportService)
	modelProviderHandler := handler.NewModelProviderHandler(repos.modelProviderRepo, secretBox, cfg.AppSecret)
	comicAssetService := service.NewComicAssetService(repos.comicAssetRepo, jobService)
	comicAssetService.SetSourceStorage(assetStore)
	comicAssetService.SetReferenceServices(assetService, jobInputService)
	comicAssetService.SetAssetFolderService(assetFolderService)
	comicAssetService.SetAssetReferenceRepository(repos.assetReferenceRepo)
	comicAssetService.SetTextGenerator(modelProviderHandler.GenerateBackgroundText)
	comicAssetService.StartAnalysisMaintenance(context.Background(), service.ComicAnalysisMaintenanceInterval)
	comicAssetService.SetImageJobResolver(func(requestedModel string, jobType string) (service.ComicImageJobResolution, error) {
		resolved, err := modelProviderHandler.ResolveBackgroundImageJob(requestedModel, jobType)
		if err != nil {
			return service.ComicImageJobResolution{}, err
		}
		return service.ComicImageJobResolution{Selector: resolved.Selector, Model: resolved.Model, TaskKwargs: resolved.TaskKwargs}, nil
	})
	comicAssetHandler := handler.NewComicAssetHandler(comicAssetService)
	if strings.TrimSpace(cfg.CeleryBrokerURL) != "" {
		comicAssetService.StartDispatcher(context.Background(), service.ComicBatchDispatchInterval)
	}
	materialService := service.NewSeedanceMaterialService(repos.modelProviderRepo, secretBox)
	seedanceAssetService := service.NewSeedanceAssetService(repos.modelProviderRepo, repos.seedanceAssetRepo, secretBox, assetStore, cfg.PublicAssetBaseURL)
	aiHandler := handler.NewAIHandler(modelProviderHandler, jobService, repos.monitoringRepo)
	aiHandler.SetJobInputService(jobInputService)
	aiHandler.SetAssetFolderService(assetFolderService)
	aiHandler.SetSeedanceMaterialService(materialService)
	aiHandler.SetSeedanceAssetService(seedanceAssetService)
	materialHandler := handler.NewSeedanceMaterialHandler(materialService)
	seedanceAssetHandler := handler.NewSeedanceAssetHandler(seedanceAssetService, cfg)
	jobHandler := handler.NewJobHandler(jobService)
	adminMonitoringHandler := handler.NewAdminMonitoringHandler(repos.monitoringRepo, storageStatus, dbStatus)
	announcementHandler := handler.NewAnnouncementHandler(repos.announcementRepo)
	userPreferenceHandler := handler.NewUserPreferenceHandler(repos.userPreferenceRepo)
	promptHandler := handler.NewPromptHandler(service.NewPromptCatalog())
	webDAVProxyHandler, err := handler.NewWebDAVProxyHandler(cfg)
	if err != nil {
		panic(fmt.Sprintf("invalid WebDAV proxy configuration: %v", err))
	}

	r.GET("/health", func(c *gin.Context) {
		response.OK(c, gin.H{
			"service":             "AI Manju API (Go)",
			"storage":             storageStatus,
			"db":                  dbStatus,
			"auth_bootstrap":      cfg.HasAdminBootstrap(),
			"public_signup":       cfg.AllowPublicSignup,
			"persistent_required": cfg.RequirePersistentStorage,
			"request_id":          response.RequestID(c),
		})
	})
	r.POST("/webdav-proxy", webDAVProxyHandler.Proxy)

	api := r.Group("/api")
	{
		api.GET("/ping", func(c *gin.Context) {
			response.OK(c, gin.H{"message": "pong"})
		})
		api.GET("/prompts", promptHandler.List)

		authRoutes := api.Group("/auth")
		{
			authRoutes.POST("/register", authHandler.Register)
			authRoutes.POST("/login", authHandler.Login)
			authRoutes.GET("/me", middleware.RequireAuth(authService), authHandler.Me)
			authRoutes.POST("/logout", middleware.RequireAuth(authService), authHandler.Logout)
		}

		userRoutes := api.Group("/user", middleware.RequireAuth(authService))
		{
			userRoutes.GET("/preferences", userPreferenceHandler.Get)
			userRoutes.PUT("/preferences", userPreferenceHandler.Put)
		}

		admin := api.Group("/admin", middleware.RequireSuperAdmin(authService))
		{
			admin.GET("/users", authHandler.ListUsers)
			admin.POST("/users", authHandler.CreateUser)
			admin.PUT("/users/:id", authHandler.UpdateUser)
			admin.GET("/model-provider-presets", modelProviderHandler.Presets)
			admin.GET("/model-provider", modelProviderHandler.Get)
			admin.PUT("/model-provider", modelProviderHandler.Put)
			admin.POST("/model-provider/test", modelProviderHandler.Test)
			admin.POST("/model-provider/models", modelProviderHandler.Models)
			admin.GET("/model-providers", modelProviderHandler.List)
			admin.POST("/model-providers", modelProviderHandler.Create)
			admin.GET("/model-providers/:id", modelProviderHandler.GetByID)
			admin.PUT("/model-providers/:id", modelProviderHandler.PutByID)
			admin.DELETE("/model-providers/:id", modelProviderHandler.Delete)
			admin.POST("/model-providers/:id/test", modelProviderHandler.TestByID)
			admin.POST("/model-providers/:id/models", modelProviderHandler.ModelsByID)
			admin.GET("/monitoring", adminMonitoringHandler.Get)
			admin.GET("/announcements", announcementHandler.AdminList)
			admin.POST("/announcements", announcementHandler.AdminCreate)
			admin.POST("/announcements/:id/republish", announcementHandler.AdminRepublish)
			admin.POST("/announcements/:id/revoke", announcementHandler.AdminRevoke)
			admin.GET("/seedance-assets", seedanceAssetHandler.AdminList)
			admin.GET("/seedance-assets/readiness", seedanceAssetHandler.AdminReadiness)
			admin.POST("/seedance-assets/upload", seedanceAssetHandler.AdminUpload)
			admin.POST("/seedance-assets/register-url", seedanceAssetHandler.AdminRegisterURL)
			admin.GET("/seedance-assets/:id", seedanceAssetHandler.AdminGet)
			admin.PUT("/seedance-assets/:id", seedanceAssetHandler.AdminUpdate)
			admin.DELETE("/seedance-assets/:id", seedanceAssetHandler.AdminDelete)
			admin.POST("/seedance-assets/sync", seedanceAssetHandler.AdminSync)
			admin.POST("/seedance-assets/poll", seedanceAssetHandler.AdminPoll)
			admin.GET("/seedance-asset-tags", seedanceAssetHandler.ListTags)
			admin.POST("/seedance-asset-tags", seedanceAssetHandler.UpsertTag)
			admin.PUT("/seedance-asset-tags/:id", seedanceAssetHandler.UpsertTag)
			admin.DELETE("/seedance-asset-tags/:id", seedanceAssetHandler.DeleteTag)
			admin.POST("/seedance-assets/:id/tags/:tag_id", seedanceAssetHandler.AddTag)
			admin.DELETE("/seedance-assets/:id/tags/:tag_id", seedanceAssetHandler.RemoveTag)
		}

		ai := api.Group("/ai", middleware.RequireAuth(authService))
		{
			ai.GET("/models", modelProviderHandler.AggregatedModels)
			ai.POST("/text", aiHandler.Text)
			ai.POST("/images/generations", aiHandler.ImageGenerations)
			ai.POST("/image/generations", aiHandler.ImageGenerations)
			ai.POST("/images/edits", aiHandler.ImageEdits)
			ai.POST("/image/edits", aiHandler.ImageEdits)
			ai.POST("/videos", aiHandler.VideoTaskCreate)
			ai.GET("/videos/:id", aiHandler.VideoTaskGet)
			ai.GET("/videos/:id/content", aiHandler.VideoTaskContent)
			ai.POST("/contents/generations/tasks", aiHandler.SeedanceTaskCreate)
			ai.GET("/contents/generations/tasks/:id", aiHandler.SeedanceTaskGet)
			ai.GET("/contents/generations/tasks/:id/content", aiHandler.SeedanceTaskContent)
			ai.POST("/audio/speech", aiHandler.AudioSpeech)
			ai.POST("/materials/visual-validate-sessions", materialHandler.CreateVisualValidateSession)
			ai.POST("/materials/real-validate-h5", materialHandler.CreateRealValidateH5)
			ai.GET("/materials/visual-validate-result", materialHandler.GetVisualValidateResult)
			ai.POST("/materials/groups", materialHandler.CreateGroup)
			ai.GET("/materials/groups/:id", materialHandler.GetGroup)
			ai.DELETE("/materials/groups/:id", materialHandler.DeleteGroup)
			ai.POST("/materials", materialHandler.CreateAsset)
			ai.POST("/materials/ensure-active", materialHandler.EnsureActive)
			ai.GET("/materials/:id", materialHandler.GetAsset)
			ai.DELETE("/materials/:id", materialHandler.DeleteAsset)
			ai.GET("/seedance-assets/mentions", seedanceAssetHandler.Mentions)
			ai.POST("/seedance-assets/ensure-active", seedanceAssetHandler.EnsureActive)
		}

		projects := api.Group("/projects", middleware.RequireAuth(authService))
		{
			projects.GET("", projectHandler.GetProjects)
			projects.POST("", projectHandler.CreateProject)
			projects.GET("/:id", projectHandler.GetProject)
			projects.PUT("/:id", projectHandler.UpdateProject)
			projects.DELETE("/:id", projectHandler.DeleteProject)
			projects.GET("/:id/snapshot", projectHandler.GetCanvasSnapshot)
			projects.PUT("/:id/snapshot", projectHandler.UpdateCanvasSnapshot)
		}

		comicProjects := api.Group("/comic-asset-projects", middleware.RequireAuth(authService))
		{
			comicProjects.GET("", comicAssetHandler.ListProjects)
			comicProjects.POST("", comicAssetHandler.CreateProject)
			comicProjects.POST("/import", comicAssetHandler.ImportProject)
			comicProjects.GET("/:projectId", comicAssetHandler.GetProject)
			comicProjects.GET("/:projectId/source", comicAssetHandler.ProjectSource)
			comicProjects.PUT("/:projectId", comicAssetHandler.UpdateProject)
			comicProjects.DELETE("/:projectId", comicAssetHandler.DeleteProject)
			comicProjects.POST("/:projectId/assets", comicAssetHandler.CreateAsset)
			comicProjects.PUT("/:projectId/assets/:assetId", comicAssetHandler.UpdateAsset)
			comicProjects.DELETE("/:projectId/assets/:assetId", comicAssetHandler.DeleteAsset)
			comicProjects.POST("/:projectId/assets/:assetId/prompt-preview", comicAssetHandler.PreviewPrompt)
			comicProjects.PUT("/:projectId/assets/:assetId/prompt", comicAssetHandler.SavePrompt)
			comicProjects.POST("/:projectId/assets/:assetId/prompt-optimize", comicAssetHandler.OptimizePrompt)
			comicProjects.POST("/:projectId/prompts/bulk-approve", comicAssetHandler.BulkApprovePrompts)
			comicProjects.GET("/:projectId/generation-batches", comicAssetHandler.ListBatches)
			comicProjects.POST("/:projectId/generation-batches", comicAssetHandler.CreateBatch)
		}

		comicAnalysisSessions := api.Group("/comic-asset-analysis-sessions", middleware.RequireAuth(authService))
		{
			comicAnalysisSessions.POST("", comicAssetHandler.CreateAnalysisSession)
			comicAnalysisSessions.GET("/:sessionId", comicAssetHandler.GetAnalysisSession)
			comicAnalysisSessions.POST("/:sessionId/revisions", comicAssetHandler.CreateAnalysisRevision)
			comicAnalysisSessions.PUT("/:sessionId/active-revision", comicAssetHandler.SetActiveAnalysisRevision)
			comicAnalysisSessions.POST("/:sessionId/confirm", comicAssetHandler.ConfirmAnalysisSession)
		}

		comicBatches := api.Group("/comic-asset-generation-batches", middleware.RequireAuth(authService))
		{
			comicBatches.GET("/:batchId", comicAssetHandler.GetBatch)
			comicBatches.POST("/:batchId/pause", comicAssetHandler.PauseBatch)
			comicBatches.POST("/:batchId/resume", comicAssetHandler.ResumeBatch)
			comicBatches.POST("/:batchId/stop", comicAssetHandler.StopBatch)
			comicBatches.POST("/:batchId/items/:itemId/retry", comicAssetHandler.RetryItem)
			comicBatches.POST("/:batchId/retry-failed", comicAssetHandler.RetryFailed)
		}

		jobs := api.Group("/jobs", middleware.RequireAuth(authService))
		{
			jobs.POST("", jobHandler.Create)
			jobs.GET("", jobHandler.List)
			jobs.GET("/:id", jobHandler.Get)
			jobs.POST("/:id/cancel", jobHandler.Cancel)
			jobs.GET("/:id/stream", jobHandler.Stream)
		}

		assets := api.Group("/assets", middleware.RequireAuth(authService))
		{
			assets.GET("", assetHandler.List)
			assets.POST("", assetHandler.Upload)
			assets.GET("/library", assetHandler.ListLibrary)
			assets.POST("/bulk-move", assetHandler.BulkMove)
			assets.POST("/bulk-tags", tagHandler.BulkAssetTags)
			assets.POST("/trash-preflight", assetHandler.TrashPreflight)
			assets.POST("/bulk-trash", assetHandler.BulkTrash)
			assets.GET("/trash/library", assetHandler.ListTrashLibrary)
			assets.GET("/trash", assetHandler.ListTrash)
			assets.POST("/bulk-restore", assetHandler.BulkRestore)
			assets.DELETE("/trash", assetHandler.EmptyTrash)
			assets.GET("/:id", assetHandler.Get)
			assets.PUT("/:id/metadata", assetHandler.UpdateMetadata)
			assets.GET("/:id/content", assetHandler.Content)
			assets.GET("/:id/lineage", assetHandler.Lineage)
			assets.GET("/:id/stats", assetHandler.Stats)
			assets.GET("/:id/user-state", assetHandler.UserState)
			assets.PUT("/:id/user-state", assetHandler.PutUserState)
			assets.GET("/:id/usage-events", assetHandler.UsageEvents)
			assets.GET("/:id/tags", tagHandler.AssetTags)
			assets.POST("/:id/tags", tagHandler.BindAsset)
			assets.DELETE("/:id/tags/:tagId", tagHandler.RemoveAssetTag)
			assets.POST("/:id/tags/resync-inherited", assetHandler.ResyncInheritedTags)
			assets.DELETE("/:id/permanent", assetHandler.PermanentDelete)
			assets.DELETE("/:id", assetHandler.Delete)
		}

		tags := api.Group("/tags", middleware.RequireAuth(authService))
		{
			tags.GET("", tagHandler.List)
			tags.POST("", tagHandler.Create)
			tags.POST("/bulk-move", tagHandler.BulkMove)
			tags.POST("/bulk-delete", tagHandler.BulkDelete)
			tags.GET("/:tagId", tagHandler.Get)
			tags.PUT("/:tagId", tagHandler.Update)
			tags.DELETE("/:tagId", tagHandler.Delete)
			tags.POST("/:tagId/move", tagHandler.Move)
			tags.POST("/:tagId/aliases", tagHandler.CreateAlias)
			tags.DELETE("/:tagId/aliases/:aliasId", tagHandler.DeleteAlias)
			tags.GET("/:tagId/assets", tagHandler.Assets)
			tags.GET("/:tagId/prompts", tagHandler.Prompts)
		}

		assetFolders := api.Group("/asset-folders", middleware.RequireAuth(authService))
		{
			assetFolders.GET("", assetFolderHandler.List)
			assetFolders.POST("", assetFolderHandler.Create)
			assetFolders.PUT("/:folderId", assetFolderHandler.Update)
			assetFolders.DELETE("/:folderId", assetFolderHandler.Delete)
		}

		assetExports := api.Group("/asset-exports", middleware.RequireAuth(authService))
		{
			assetExports.POST("", assetExportHandler.Create)
			assetExports.GET("", assetExportHandler.List)
			assetExports.GET("/:exportId", assetExportHandler.Get)
			assetExports.POST("/:exportId/cancel", assetExportHandler.Cancel)
			assetExports.GET("/:exportId/content", assetExportHandler.Content)
		}

		announcements := api.Group("/announcements", middleware.RequireAuth(authService))
		{
			announcements.GET("/current", announcementHandler.Current)
			announcements.POST("/:id/read", announcementHandler.MarkRead)
			announcements.GET("/stream", announcementHandler.Stream)
		}
	}

	return r
}

type repositories struct {
	projectRepo        repository.ProjectRepository
	userRepo           repository.UserRepository
	modelProviderRepo  repository.ModelProviderRepository
	assetRepo          repository.AssetRepository
	assetReferenceRepo repository.AssetReferenceRepository
	assetFolderRepo    repository.AssetFolderRepository
	tagRepo            repository.TagRepository
	assetLineageRepo   repository.AssetLineageRepository
	assetUsageRepo     repository.AssetUsageRepository
	assetExportRepo    repository.AssetExportRepository
	monitoringRepo     repository.MonitoringRepository
	announcementRepo   repository.AnnouncementRepository
	userPreferenceRepo repository.UserPreferenceRepository
	jobRepo            repository.JobRepository
	seedanceAssetRepo  repository.SeedanceAssetRepository
	comicAssetRepo     repository.ComicAssetRepository
}

func newRepositories(cfg config.Config) (repositories, string, string) {
	if cfg.StorageDriver != "postgres" {
		if cfg.RequirePersistentStorage {
			panic("persistent storage is required but STORAGE_DRIVER is not postgres")
		}
		if cfg.StorageDriver != "memory" {
			panic(fmt.Sprintf("unsupported STORAGE_DRIVER %q", cfg.StorageDriver))
		}
		return newMemoryRepositories(), "memory", "disabled"
	}
	if cfg.DatabaseURL == "" {
		panic("PostgreSQL storage requires DATABASE_URL or DB_HOST configuration")
	}

	db, err := database.OpenPostgresWithPool(cfg.DatabaseURL, database.PoolConfig{
		MaxOpenConns: cfg.DBMaxOpenConns,
		MaxIdleConns: cfg.DBMaxIdleConns,
		MaxLifetime:  time.Duration(cfg.DBConnMaxLifetimeSeconds) * time.Second,
	})
	if err != nil {
		panic(fmt.Sprintf("PostgreSQL storage is unavailable: %v", err))
	}

	return repositories{
		projectRepo:        repository.NewGormProjectRepository(db),
		userRepo:           repository.NewGormUserRepository(db),
		modelProviderRepo:  repository.NewGormModelProviderRepository(db),
		assetRepo:          repository.NewGormAssetRepository(db),
		assetReferenceRepo: repository.NewGormAssetReferenceRepository(db),
		assetFolderRepo:    repository.NewGormAssetFolderRepository(db),
		tagRepo:            repository.NewGormTagRepository(db),
		assetLineageRepo:   repository.NewGormAssetLineageRepository(db),
		assetUsageRepo:     repository.NewGormAssetUsageRepository(db),
		assetExportRepo:    repository.NewGormAssetExportRepository(db),
		monitoringRepo:     repository.NewGormMonitoringRepository(db),
		announcementRepo:   repository.NewGormAnnouncementRepository(db),
		userPreferenceRepo: repository.NewGormUserPreferenceRepository(db),
		jobRepo:            repository.NewGormJobRepository(db),
		seedanceAssetRepo:  repository.NewGormSeedanceAssetRepository(db),
		comicAssetRepo:     repository.NewGormComicAssetRepository(db),
	}, "postgres", "ok"
}

func newMemoryRepositories() repositories {
	assetRepo := repository.NewMemoryAssetRepository()
	return repositories{
		projectRepo:        repository.NewMemoryProjectRepository(),
		userRepo:           repository.NewMemoryUserRepository(),
		modelProviderRepo:  repository.NewMemoryModelProviderRepository(),
		assetRepo:          assetRepo,
		assetReferenceRepo: repository.NewMemoryAssetReferenceRepository(),
		assetFolderRepo:    repository.NewMemoryAssetFolderRepository(),
		tagRepo:            repository.NewMemoryTagRepository(assetRepo),
		assetLineageRepo:   repository.NewMemoryAssetLineageRepository(),
		assetUsageRepo:     repository.NewMemoryAssetUsageRepository(),
		assetExportRepo:    repository.NewMemoryAssetExportRepository(),
		monitoringRepo:     repository.NewMemoryMonitoringRepository(),
		announcementRepo:   repository.NewMemoryAnnouncementRepository(),
		userPreferenceRepo: repository.NewMemoryUserPreferenceRepository(),
		jobRepo:            repository.NewMemoryJobRepository(),
		seedanceAssetRepo:  repository.NewMemorySeedanceAssetRepository(),
		comicAssetRepo:     repository.NewMemoryComicAssetRepository(),
	}
}
