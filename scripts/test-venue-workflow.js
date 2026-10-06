#!/usr/bin/env node
// Execute the real artifact shell steps with synthetic files; no GitHub or venue calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/weekly-songbook.yml'), 'utf8');
const files = ['karaoke_songs_enriched.json', 'audio_enrichment.json', 'era_enrichment.json',
    'karaoke_explorer.js', 'karaoke_explorer.html', 'manifest.json', 'sw.js'];
function stepScript(name) {
    const lines = workflow.split('\n');
    const start = lines.indexOf(`      - name: ${name}`);
    assert(start >= 0, `Missing step: ${name}`);
    let run = start + 1;
    while (run < lines.length && !lines[run].startsWith('      - ') && lines[run] !== '        run: |') run++;
    assert.equal(lines[run], '        run: |', `Missing shell for ${name}`);
    const body = [];
    for (let i = run + 1; i < lines.length && (lines[i].startsWith('          ') || lines[i] === ''); i++) body.push(lines[i].slice(10));
    return body.join('\n');
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-workflow-test-'));
const run = (script, cwd, env = {}) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000,
});
try {
    const prepared = path.join(temp, 'prepared');
    fs.mkdirSync(path.join(prepared, 'metadata_cache'), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(prepared, file), `validated ${file}\n`);
    const output = path.join(temp, 'outputs');
    fs.writeFileSync(output, '');
    const packaged = run(stepScript('Package validated additions'), prepared, { GITHUB_OUTPUT: output });
    assert.equal(packaged.status, 0, packaged.stderr);
    const archive = fs.readFileSync(path.join(prepared, 'metadata_cache/songbook-update.tar'));
    const digest = createHash('sha256').update(archive).digest('hex');

    for (const [step, directory] of [['Apply validated additions', 'verify'], ['Verify and apply validated additions', 'publish']]) {
        const workspace = path.join(temp, directory);
        const download = path.join(workspace, 'metadata_cache', directory);
        fs.mkdirSync(download, { recursive: true });
        const tar = path.join(download, 'songbook-update.tar');
        const checksum = path.join(download, 'songbook-update.tar.sha256');
        const writeArtifact = bytes => {
            fs.writeFileSync(tar, bytes);
            // Model an attacker replacing both payload and its accompanying checksum.
            fs.writeFileSync(checksum, `${createHash('sha256').update(bytes).digest('hex')}  songbook-update.tar\n`);
        };
        writeArtifact(archive);
        const good = run(stepScript(step), workspace, { UPDATE_SHA256: digest });
        assert.equal(good.status, 0, good.stderr);
        for (const file of files) assert.equal(fs.readFileSync(path.join(workspace, file), 'utf8'), `validated ${file}\n`);

        const attacker = path.join(temp, `replacement-${directory}`);
        fs.mkdirSync(attacker);
        for (const file of files) fs.writeFileSync(path.join(attacker, file), `replaced ${file}\n`);
        execFileSync('tar', ['-cf', tar, ...files], { cwd: attacker });
        writeArtifact(fs.readFileSync(tar));
        // The former self-supplied checksum gate accepts this replacement.
        assert.equal(run('sha256sum --check songbook-update.tar.sha256', download).status, 0);
        const replaced = run(stepScript(step), workspace, { UPDATE_SHA256: digest });
        assert.notEqual(replaced.status, 0, `${step} accepted a replacement artifact with its own checksum`);
        assert.equal(fs.readFileSync(path.join(workspace, 'karaoke_explorer.js'), 'utf8'), 'validated karaoke_explorer.js\n', 'Reject before extraction');

        writeArtifact(archive);
        for (const invalid of ['', 'not-a-hash', `${digest}\n`, `${digest}  other.tar`]) {
            assert.notEqual(run(stepScript(step), workspace, { UPDATE_SHA256: invalid }).status, 0, 'Missing/malformed trusted digest must fail closed');
        }
        fs.unlinkSync(tar);
        assert.notEqual(run(stepScript(step), workspace, { UPDATE_SHA256: digest }).status, 0, 'Missing archive must fail closed');
    }
    assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`^sha256=${digest}$`, 'm'), 'Package exports the exact tar digest');
    // A failed hashing command must abort preparation instead of exporting an empty digest.
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'sha256sum'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(output, '');
    assert.notEqual(run(stepScript('Package validated additions'), prepared, {
        GITHUB_OUTPUT: output, PATH: `${bin}:${process.env.PATH}`,
    }).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), '');

    // Connect the executable shell checks to the workflow's trusted producers.
    // These values must come from prepare, never the dependency-executing verify job.
    const jobs = Object.fromEntries([...workflow.matchAll(/^  (prepare|verify|publish):\n([\s\S]*?)(?=^  \w+:\n|$(?![\s\S]))/gm)]
        .map(match => [match[1], match[2]]));
    assert.match(jobs.prepare, /artifact_id: \$\{\{ steps\.artifact\.outputs\.artifact-id \}\}/);
    assert.match(jobs.prepare, /archive_sha256: \$\{\{ steps\.package\.outputs\.sha256 \}\}/);
    assert.match(jobs.prepare, /name: Package validated additions\n        id: package/);
    assert.match(jobs.prepare, /name: Save validated additions\n        id: artifact/);
    for (const job of [jobs.verify, jobs.publish]) {
        assert.match(job, /artifact-ids: \$\{\{ needs\.prepare\.outputs\.artifact_id \}\}\n          merge-multiple: true/);
        assert.match(job, /UPDATE_SHA256: \$\{\{ needs\.prepare\.outputs\.archive_sha256 \}\}/);
        assert.doesNotMatch(job, /name: validated-songbook-update/);
    }
    assert.doesNotMatch(jobs.prepare + jobs.verify, /contents: write/);
    assert.doesNotMatch(jobs.publish, /\b(?:npm|npx|playwright)\b/);
    console.log('ok   original artifact accepted; substituted payload/checksum, malformed digest and missing archive rejected before extraction');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
