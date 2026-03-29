// Package mobile exposes CareerForge for gomobile Android/iOS bindings.
package mobile

import (
	"log"
	"net/http"
	"path/filepath"

	"github.com/shiroonigami23-ui/careerforge-go/internal/server"
)

var srv *server.Server

// Start launches the embedded HTTP server on 127.0.0.1:8080. Pass app internal storage root.
func Start(rootPath string) {
	cfg := server.Config{
		RootDir:  rootPath,
		StaticFS: nil, // Capacitor WebView serves UI; API-only server on loopback.
		FAQPath:  filepath.Join(rootPath, "knowledge", "faq_responses.json"),
	}
	var err error
	srv, err = server.New(cfg)
	if err != nil {
		log.Println("careerforge server:", err)
		return
	}
	go func() {
		if err := http.ListenAndServe("127.0.0.1:8080", srv.Handler()); err != nil {
			log.Println("careerforge ListenAndServe:", err)
		}
	}()
}
