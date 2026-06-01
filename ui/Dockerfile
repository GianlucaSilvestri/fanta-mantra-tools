FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare yarn@stable --activate

COPY package.json yarn.lock* .yarnrc.yml ./
RUN yarn install

COPY . .

RUN yarn i18n:build

EXPOSE 5173
