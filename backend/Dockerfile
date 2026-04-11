FROM heroiclabs/nakama:3.22.0

COPY ./nakama/data/modules /nakama/data/modules
COPY ./nakama/data/local.yml /nakama/data/local.yml

EXPOSE 7350

ENTRYPOINT ["/bin/sh", "-ec"]
CMD ["/nakama/nakama migrate up --database.address \"$DATABASE_URL\" && exec /nakama/nakama --name nakama1 --database.address \"$DATABASE_URL\" --logger.level INFO --session.token_expiry_sec 7200 --runtime.path /nakama/data/modules --config /nakama/data/local.yml"]