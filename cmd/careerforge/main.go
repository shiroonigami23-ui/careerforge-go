package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/shiroonigami23-ui/careerforge-go/internal/server"
)

//go:embed all:web/dist
var web embed.FS // built by frontend: npm run build in ../frontend

func main() {
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if r := os.Getenv("CAREERFORGE_ROOT"); r != "" {
		root = r
	}
	faqPath := filepath.Join(root, "knowledge", "faq_responses.json")
	dist, err := fs.Sub(web, "web/dist")
	if err != nil {
		log.Fatal("embed: run `cd frontend && npm run build` first:", err)
	}
	srv, err := server.New(server.Config{
		RootDir:  root,
		StaticFS: dist,
		FAQPath:  faqPath,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer srv.Close()

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("%s listening on http://127.0.0.1%s", "CareerForge", addr)
	log.Fatal(http.ListenAndServe(addr, srv.Handler()))
}
