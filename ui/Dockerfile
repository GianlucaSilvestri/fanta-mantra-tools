FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare yarn@stable --activate

COPY package.json yarn.lock* .yarnrc.yml ./
RUN yarn install

COPY . .

EXPOSE 5173
