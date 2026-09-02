package response

import "github.com/gin-gonic/gin"

func OK(c *gin.Context, data any) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    data,
	})
}

func Created(c *gin.Context, data any) {
	c.JSON(201, gin.H{
		"success": true,
		"data":    data,
	})
}

func Accepted(c *gin.Context, data any) {
	c.JSON(202, gin.H{
		"success": true,
		"data":    data,
	})
}

func NoContent(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    gin.H{},
	})
}

func Error(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"success":    false,
		"error":      message,
		"request_id": RequestID(c),
	})
}

func ErrorWithData(c *gin.Context, status int, message string, data any) {
	c.JSON(status, gin.H{
		"success":    false,
		"error":      message,
		"data":       data,
		"request_id": RequestID(c),
	})
}

func RequestID(c *gin.Context) string {
	value, ok := c.Get("request_id")
	if !ok {
		return ""
	}

	requestID, ok := value.(string)
	if !ok {
		return ""
	}

	return requestID
}
