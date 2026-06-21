# YouTube Shorts uploader (OAuth desktop flow).
# usage: python upload_yt.py <video.mp4> <title> <descFile> [privacy=unlisted] [publishAtISO]
import sys, glob, os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

HERE = os.path.dirname(os.path.abspath(__file__))
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT = glob.glob(os.path.join(HERE, "client_secret*.json"))[0]
TOKEN = os.path.join(HERE, "token.json")

def creds():
    c = None
    if os.path.exists(TOKEN):
        c = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not c or not c.valid:
        if c and c.expired and c.refresh_token:
            c.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT, SCOPES)
            c = flow.run_local_server(port=8765, open_browser=False, access_type="offline", prompt="consent",
                                      authorization_prompt_message="AUTH URL >>> {url}")
        open(TOKEN, "w").write(c.to_json())
    return c

def main():
    video, title, descFile = sys.argv[1], sys.argv[2], sys.argv[3]
    privacy = sys.argv[4] if len(sys.argv) > 4 else "unlisted"
    publishAt = sys.argv[5] if len(sys.argv) > 5 else None
    desc = open(descFile, encoding="utf-8").read()
    yt = build("youtube", "v3", credentials=creds())
    status = {"privacyStatus": ("private" if publishAt else privacy), "selfDeclaredMadeForKids": False}
    if publishAt:
        status["publishAt"] = publishAt
    body = {
        "snippet": {"title": title, "description": desc,
                    "tags": ["AI", "Shorts", "สอนAI", "โกสินทร์ต้องบินได้"], "categoryId": "27"},
        "status": status,
    }
    media = MediaFileUpload(video, chunksize=-1, resumable=True, mimetype="video/mp4")
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        st, resp = req.next_chunk()
    ch = resp.get("snippet", {}).get("channelTitle", "?")
    print("UPLOADED video_id:", resp["id"], "| channel:", ch, "| https://youtube.com/shorts/" + resp["id"])

if __name__ == "__main__":
    main()
