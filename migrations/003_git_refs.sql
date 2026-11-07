CREATE TABLE git_sync_refs (
  repository TEXT NOT NULL,
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  PRIMARY KEY (repository, ref)
);
