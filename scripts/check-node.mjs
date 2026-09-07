// Warns, before the build, about a Node that has a known sharp edge here.
//
// Astro 7's Windows EPERM recovery calls fs.rmdirSync(dir, {recursive:true}),
// which Node 26 removed. Builds still succeed on Node 26 - right up until
// something holds a handle on dist/ (a stale `astro dev` or `workerd`, a
// preview server). Then Astro tries to recover, dies inside node_modules with
// "The property 'options.recursive' is no longer supported", and leaves dist/
// already emptied. That is how a half-built dist/ gets deployed.
//
// A warning, not a failure: the pinned Node in .nvmrc is the supported one, but
// refusing to build on a Node that mostly works would cost more than it saves.
// The guarantee that a broken build never ships lives in `npm run deploy`,
// which stops on a failed build and then checks the output before uploading.
const supported = [22, 24];
const major = Number(process.versions.node.split('.')[0]);

if (!supported.includes(major)) {
  console.warn(
    `\n! Node ${process.versions.node} is not the pinned version (.nvmrc: 24.19.0, supported majors: ${supported.join(', ')}).`
  );
  if (major > Math.max(...supported)) {
    console.warn(
      '  Newer Node removed fs.rmdirSync(..., {recursive:true}), which Astro 7 still calls\n' +
        '  when it cleans a locked dist/ on Windows. If this build dies there, close whatever\n' +
        '  is holding dist/ (a stale dev server or workerd) and build again - and do not\n' +
        '  deploy the leftovers.\n'
    );
  }
}
