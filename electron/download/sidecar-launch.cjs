function sidecarArguments({ script, port, token, root }) {
  // base64url credentials may begin with '-'. argparse treats a separate
  // '--token', '-...' pair as another option; the equals form is unambiguous.
  const args = ['--port', String(port), `--token=${token}`, '--project-root', root];
  return script ? [script, ...args] : args;
}
module.exports = { sidecarArguments };
