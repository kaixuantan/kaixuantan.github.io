FROM python:3-slim
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY ./amqp_setup.py .
CMD [ "python", "./amqp_setup.py" ]