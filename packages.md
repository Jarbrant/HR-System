# Dependencies and Tech Stack

This document provides an overview of the key dependencies and technologies used in the HR-System project.

## Core Technologies

### Cloudflare Workers
**Role**: Runtime environment  
**Description**: The application runs as a Cloudflare Worker, providing a serverless compute platform at the edge. This enables low-latency responses and global distribution.

### Wrangler
**Role**: Build and deployment tool  
**Description**: Wrangler is the official CLI tool for developing, testing, and deploying Cloudflare Workers. It handles bundling, configuration management, and deployment workflows.

### Cloudflare AI Binding
**Role**: AI capabilities  
**Description**: The project uses Cloudflare's AI binding to integrate AI-powered features directly into the Worker. This provides access to machine learning models for generating training content, questions, and responses.

### GitHub Pages
**Role**: Static hosting for UI  
**Description**: The user interface is hosted on GitHub Pages, providing reliable static file hosting for HTML, CSS, and JavaScript assets. The UI communicates with the Cloudflare Worker API for dynamic functionality.

## Architecture

The project follows a decoupled architecture:
- **Frontend**: Static files hosted on GitHub Pages
- **Backend**: Cloudflare Worker handling API requests and AI processing
- **AI Rules**: JSON-based configuration system (`ai-rules/`) defining content generation rules and policies
