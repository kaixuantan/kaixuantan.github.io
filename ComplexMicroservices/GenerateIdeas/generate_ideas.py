from flask import Flask
from flask_cors import CORS
from flask import request
import json
import requests
import os

from process_pdf import process_pdf
from send_amqp import send_log, send_notif
from get_users_email import get_users_email

from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
CORS(app)

@app.route('/ideas/generate/<subGroupId>/<userId>', methods=['GET'])
def generate_ideas(subGroupId, userId):
    # Here you can add the functionality you want.
    # For example, let's return a simple JSON response.
    
    text = process_pdf(subGroupId)
    # print(text)
    data = {
                "document": text,
                "subGroupId": subGroupId,
                "type": "md",
            }
    return upload_file(subGroupId, "md", data, userId)
    

@app.route('/ideas/upload', methods=['POST'])
def upload():
    data = request.get_json()
    subGroupId = data['subGroupId']
    fileType = data['type']
    
    return upload_file(subGroupId, fileType, data)

def upload_file(subGroupId, fileType, fileData, userId):
    headers = {
        'Content-Type': 'application/json',
        "X-Doc-AppId": os.getenv("X_Doc_AppId"),
        "X-Doc-Key": os.getenv("X_Doc_Key"),
    }
    file_exists = check_file_exist(subGroupId, fileType)
    try:
        if file_exists:
            docId = file_exists
            url = f"https://personal-rc7vnnm9.outsystemscloud.com/DocAPI_REST/rest/v1/doc/{docId}"
            response = requests.put(url, headers=headers, data=json.dumps(fileData))
        else:
            url = "https://personal-rc7vnnm9.outsystemscloud.com/DocAPI_REST/rest/v1/doc/"
            response = requests.post(url, headers=headers, data=json.dumps(fileData))
    except Exception as error:
        print(f"Error: {error}")
        return {"error": "Failed to upload file"}
    
    if response and fileType == "md":
        # Notification and Logging
        try:
            # notify_users(subGroupId)
            send_log(subGroupId, userId, "Generate ideas", f"{userId} generated ideas and project summary for {subGroupId}")
        except Exception as error:
            print(f"Error: {error}")
            return {"error": "Failed to send notification / logs"}
    
    if response:
        return response.json()

def check_file_exist(subGroupId, fileType):
    url = f"https://personal-rc7vnnm9.outsystemscloud.com/DocAPI_REST/rest/v1/doc/subgrouptype/{subGroupId}"
    headers = {
        "X-Doc-AppId": os.getenv("X_Doc_AppId"),
        "X-Doc-Key": os.getenv("X_Doc_Key"),
        "type": fileType,
    }
    response = requests.get(url, headers=headers)
    data = response.json()
    if data["Result"]["Success"]:
        return data["DocAPI"]["docId"]
    else:
        return None

def notify_users(subGroupId):
    emails = get_users_email(subGroupId)
    for email in emails:
        send_notif(email, "Project summary and ideas generated successfully!", "Head to the project page to view the details. Feel free to Upload a new PDF file to generate the response again. \n Disclaimer: Content generated using AI, please check for accuracy.")
    
if __name__ == '__main__':
    app.run(host='0.0.0.0',port=5000, debug=True)