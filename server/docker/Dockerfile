# Use Node 20 as the base for the VS Code environment
FROM node:20-bullseye

# 1. Install system essentials and Docker CLI dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    redis-tools

# 2. Add Docker's official GPG key and repository
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. Add MongoDB Official CLI (mongosh)
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg && \
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bullseye/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# 4. Install Docker CLI and MongoDB Shell
RUN apt-get update && apt-get install -y docker-ce-cli mongodb-mongosh && \
    rm -rf /var/lib/apt/lists/*

# 5. Install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

# 6. Setup workspace environment
WORKDIR /workspace

# Create the .bin folder for proxy scripts
RUN mkdir -p /workspace/.bin
ENV PATH="/workspace/.bin:${PATH}"

# Expose the code-server port
EXPOSE 8080

CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "none", "/workspace"]