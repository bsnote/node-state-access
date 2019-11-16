import toml from "@iarna/toml";
import assert from "assert";
import EventEmitter from "events";
import fs from "fs";
import * as git from "isomorphic-git";
import path from "path";
import { promisify } from "util";

const delay = promisify(setTimeout);

git.plugins.set("fs", fs);

const StateDirPath = "state";

// tslint:disable-next-line:no-empty-interface
export interface State extends toml.JsonMap {}

export interface Options {
  pullPeriodMs?: number; // if specified, pull periodically from git repository
  filePath: string;
  gitUrl?: string;
}

declare interface StateService {
  addListener(event: "error", listener: (error: Error) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  prependListener(event: "error", listener: (error: Error) => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;
}

class StateService extends EventEmitter {
  private readonly options: Options;

  private headCommit: string | undefined;
  private state: State | undefined;

  constructor(options: Options) {
    super();
    this.options = options;
  }

  public getState() {
    assert(this.state);
    return this.state!;
  }

  public async start() {
    if (this.options.gitUrl) {
      await fs.promises.rmdir(StateDirPath, { recursive: true });
      await fs.promises.mkdir(StateDirPath, { recursive: true });

      await git.clone({
        depth: 1,
        dir: StateDirPath,
        noTags: true,
        singleBranch: true,
        url: this.options.gitUrl,
      });

      this.headCommit = await readHeadCommit();

      if (typeof this.options.pullPeriodMs !== "undefined")
        this.pullPeriodically(this.options.pullPeriodMs).catch(error => {
          if (!this.emit("error", error)) throw error;
        });
    }

    this.state = await readStateFromFile(this.options.filePath, this.options.gitUrl);
    return this.state;
  }

  private async pullPeriodically(periodMs: number) {
    while (true) {
      await delay(periodMs);

      await git.pull({
        dir: StateDirPath,
        fastForwardOnly: true,
        singleBranch: true,
      });

      const headCommit = await readHeadCommit();

      if (headCommit !== this.headCommit) {
        this.headCommit = headCommit;
        this.state = await readStateFromFile(this.options.filePath, this.options.gitUrl);
      }
    }
  }
}

export function createStateService(options: Options) {
  return new StateService(options);
}

function readHeadCommit() {
  return git.resolveRef({ dir: StateDirPath, ref: "HEAD" });
}

async function readStateFromFile(filePath: string, gitUrl?: string): Promise<State> {
  const finalFilePath = gitUrl ? path.join(StateDirPath, filePath) : filePath;
  const stateToml = await fs.promises.readFile(finalFilePath, "utf8");
  return toml.parse(stateToml);
}
