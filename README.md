# ValidDog (OpenAPI Traffic Validator)

A Chrome DevTools extension that validates API requests and responses based on an OpenAPI specification. It monitors the network traffic of the active page and verifies whether the communication complies with your defined API contract.

## Key Features

- **Real-time Monitoring:** Captures HTTP traffic while DevTools is open.
- **Schema Validation:** Automatically checks request/response bodies, headers, and parameters against your OpenAPI (Swagger) file.
- **Visual Feedback:** Instantly highlights discrepancies and validation errors.

## Development Environment

This project uses **DevContainers** for a consistent development experience.

### Setup

1. Open this repository in **VS Code** or **Cursor**.
2. Select **"Reopen in Container"** when prompted (or via the Command Palette) to start the DevContainer.

### Git SSH Configuration

You can set up your SSH keys for Git using one of the following methods:

- Place your private key in the `.devcontainer/.ssh/` folder.
- Run `ssh-keygen` inside the DevContainer terminal to generate a new key.

## Project Structure
