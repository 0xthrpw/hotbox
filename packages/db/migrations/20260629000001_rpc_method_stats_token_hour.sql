-- migrate:up

-- Token-filtered analytics queries (where token_id = ? and hour >= ?) can't use
-- the natural unique index efficiently since hour is its leading column.
create index rpc_method_stats_token_hour on rpc_method_stats (token_id, hour desc);

-- migrate:down

drop index if exists rpc_method_stats_token_hour;
