FROM debian:stretch@sha256:0a5fcee6f52d5170f557ee2447d7a10a5bdcf715dd7f0250be0b678c556a501b

COPY stretch_deps.sh /deps.sh
RUN /deps.sh && rm /deps.sh
VOLUME /webfiles
CMD cd /webfiles && ./prepare.sh && virtualenv venv && source venv/bin/activate && pip install -r requirements.txt --require-hashes && python render_templates.py -a ..
