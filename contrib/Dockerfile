FROM debian:buster@sha256:e25b64a9cf82c72080074d6b1bba7329cdd752d51574971fd37731ed164f3345

COPY buster_deps.sh /deps.sh
RUN /deps.sh && rm /deps.sh
VOLUME /webfiles
CMD cd /webfiles && ./prepare.sh && virtualenv venv && source venv/bin/activate && pip install -r requirements.txt --require-hashes && python render_templates.py -a ..
