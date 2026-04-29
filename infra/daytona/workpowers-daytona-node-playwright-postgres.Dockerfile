FROM mcr.microsoft.com/playwright:v1.59.1-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    postgresql \
    postgresql-client \
  && npm install -g pnpm@10.29.1 \
  && pnpm --version \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/workpowers-session-daemon

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/session-daemon ./apps/session-daemon

RUN pnpm install --frozen-lockfile --prefer-offline

WORKDIR /workspace
