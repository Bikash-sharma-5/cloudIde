# Use Node 20 as the base for the VS Code environment
FROM node:20-bullseye

# 1. Install system essentials and Docker CLI dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo

# 2. Add Docker's official GPG key and repository
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. Install Docker CLI (Not the full engine, just the client to talk to the socket)
RUN apt-get update && apt-get install -y docker-ce-cli

# 4. Install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# 5. Setup workspace environment
WORKDIR /workspace

# Create the .bin folder for our 'Ghost Binary' proxy scripts
RUN mkdir -p /workspace/.bin
# Add .bin to PATH so our proxy scripts (go, python) take priority
ENV PATH="/workspace/.bin:${PATH}"

# 6. Expose the VS Code port
EXPOSE 8080

# Start code-server without authentication for the dev environment
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "none", "/workspace"]