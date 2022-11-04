import WebSocket from "ws";
import "dotenv/config";

import got from "got";

const { USER_SESSION } = process.env;

if (!USER_SESSION) throw new Error("you need a USER_SESSION");

const user = "hacksore";
const repo = "test";

const getFirstCommit = async ({
  user,
  repo,
}: {
  user: string;
  repo: string;
}) => {
  // get job id
  const commitRes = await got(
    `https://api.github.com/repos/${user}/${repo}/commits`
  );

  const commitResData = JSON.parse(commitRes.body);
  return commitResData[0].sha;
};

const getSocketUrl = async () => {
  let liveLogs: any;
  const commitHash = await getFirstCommit({ user, repo });

  console.log("loaded commit", commitHash);
  // get job id
  const jobAPIResp = await got(
    `https://api.github.com/repos/${user}/${repo}/actions/runs?status=in_progress`
  );

  const jobAPIdata = JSON.parse(jobAPIResp.body);
  console.log("jobapi", jobAPIdata);

  if (jobAPIdata.workflow_runs.length === 0) {
    console.log("fuck off this aint ready yet bruv");
    return;
  }

  const jobHtmlResponse = await got(jobAPIdata.workflow_runs[0].html_url);
  const jobIdRegex = new RegExp(/data-item-id="job_(\d+)"/);
  const jobId = jobHtmlResponse.body.match(jobIdRegex)![1];
  console.log("Found job id", jobId);

  const liveLogUrl = `https://github.com/${user}/${repo}/commit/${commitHash}/checks/${jobId}/live_logs`;
  console.log(liveLogUrl);

  try {
    liveLogs = await got(liveLogUrl, {
      headers: {
        accept: "application/json",
        cookie: `user_session=${USER_SESSION}`,
      },
    }).json();
  } catch (err: any) {
    console.log(err.message);
    throw new Error("could not get the live_logs response");
  }

  try {
    const url = liveLogs.data.authenticated_url;

    const res2 = await got(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (res2.statusCode !== 200) {
      throw new Error("could not get the authenticated_url response");
    }

    const body = JSON.parse(res2.body);

    return body.logStreamWebSocketUrl;
  } catch (err) {
    console.log(err);
    throw new Error("Error getting authenticated_url");
  }
};

const socketUrl = await getSocketUrl();
const rawParams = socketUrl.split("?")[1];
const params = new URLSearchParams(rawParams);
const runId = Number(params.get("runId"));
const tenantId = params.get("tenantId");

const ws = new WebSocket(socketUrl, {
  headers: {
    Host: "pipelines.actions.githubusercontent.com",
    Origin: "https://github.com",
  },
});

const sendPacket = (ws: WebSocket, packet: any) => {
  // there is some strange termination string required
  const payload = JSON.stringify(packet) + "\x1e";
  ws.send(payload);
};

ws.on("open", () => {
  console.log("Socket opened");
  sendPacket(ws, { protocol: "json", version: 1 });
  sendPacket(ws, {
    arguments: [tenantId, runId],
    target: "WatchRunAsync",
    type: 1,
  });
  // Figure out what other packets we can send
});

// print out all messages
ws.on("message", (data) => {
  console.log(data.toString());
});

// print out all messages
ws.on("close", (errorCode) => {
  console.log(`Socket closed with code ${errorCode}`);
});
