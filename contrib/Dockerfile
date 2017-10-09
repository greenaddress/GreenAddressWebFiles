FROM debian:stretch

COPY stretch_deps.sh /deps.sh
RUN /deps.sh && rm /deps.sh
VOLUME /webfiles
CMD cd /webfiles && ./prepare.sh && virtualenv venv && source venv/bin/activate && pip install -r requirements.txt --require-hashes && python render_templates.py -a ..
