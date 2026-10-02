#!/usr/bin/env node
// Execute the actual weekly workflow shell steps against fixtures and a local
// bare Git origin. Never fetch the venue or push to GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { syncVenue } = require('./sync-venue');
const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/weekly-songbook.yml'), 'utf8').replaceAll('\r\n', '\n');
const files = ['karaoke_songs_enriched.json', 'audio_enrichment.json', 'era_enrichment.json',
    'karaoke_explorer.js', 'karaoke_explorer.html', 'manifest.json', 'sw.js'];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-weekly-test-'));
// Do not inherit a real workflow's outputs or credential into fixture commands.
const env = { ...process.env, GH_TOKEN: 'local-fixture-token', GIT_TERMINAL_PROMPT: '0' };
delete env.GITHUB_OUTPUT; delete env.GITHUB_STEP_SUMMARY;
delete process.env.GITHUB_OUTPUT; delete process.env.GITHUB_STEP_SUMMARY;
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');

function run(command, args, cwd, extraEnv = {}, succeeds = true) {
    const result = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (succeeds) assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    else assert.notEqual(result.status, 0, 'Fault must reject the workflow step');
    return result;
}
const git = (cwd, ...args) => run('git', args, cwd).stdout.trim();
function step(name) {
    const marker = `      - name: ${name}\n`;
    const offset = workflow.indexOf(marker);
    assert.ok(offset >= 0, `Find real workflow step: ${name}`);
    const block = workflow.slice(offset + marker.length).split(/\n      - /)[0];
    const script = block.split('        run: |\n')[1];
    assert.ok(script, `${name} must be a shell step`);
    return script.split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n') + '\n';
}
function shellStep(name, cwd, extraEnv = {}, succeeds = true) {
    const script = path.join(temp, 'workflow-step.sh');
    fs.writeFileSync(script, step(name));
    // A relative POSIX path also works from Git Bash on Windows.
    return run(bash, ['--noprofile', '--norc', '-eo', 'pipefail', path.relative(cwd, script).replaceAll('\\', '/')], cwd, extraEnv, succeeds);
}
function clone(name, artifact, stage) {
    const dir = path.join(temp, name);
    run('git', ['clone', '--quiet', path.join(temp, 'origin.git'), dir], temp);
    const destination = path.join(dir, 'metadata_cache', stage);
    fs.mkdirSync(destination, { recursive: true });
    for (const name of ['songbook-update.tar', 'songbook-update.tar.sha256']) fs.copyFileSync(path.join(artifact, name), path.join(destination, name));
    return dir;
}
function snapshot(dir) { return new Map(files.map(name => [name, fs.readFileSync(path.join(dir, name))])); }
function unchanged(dir, expected) {
    for (const [name, content] of expected) assert.deepEqual(fs.readFileSync(path.join(dir, name)), content, name);
}
function remoteHead() { return git(path.join(temp, 'origin.git'), 'rev-parse', 'refs/heads/main'); }

async function browserCheck(dir) {
    const playwright = require('playwright');
    const name = process.env.BROWSER || 'chromium';
    assert.ok(['chromium', 'firefox', 'webkit'].includes(name));
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    const server = http.createServer((request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            const filename = path.resolve(dir, '.' + (pathname === '/' ? '/karaoke_explorer.html' : pathname));
            if (!filename.startsWith(dir + path.sep)) { response.writeHead(403); response.end(); return; }
            response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
            response.end(fs.readFileSync(filename));
        } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await playwright[name].launch({ headless: true });
        const page = await browser.newPage();
        // All browser requests must remain on this private fixture server.
        const base = `http://127.0.0.1:${server.address().port}`;
        const external = [];
        await page.route('**/*', route => {
            if (route.request().url().startsWith(base + '/')) return route.continue();
            external.push(route.request().url()); return route.abort();
        });
        await page.goto(base + '/');
        await page.waitForFunction(() => state.songs.length && !document.querySelector('.skeleton'));
        const added = await page.evaluate(() => {
            const song = state.songs.find(song => song.song === 'Weekly Fixture Song 8675309');
            return { title: song?.song, identity: song && getSongIdentity(song), audio: song?.audioSource };
        });
        assert.equal(added.title, 'Weekly Fixture Song 8675309');
        assert.ok(added.identity);
        assert.equal(added.audio, undefined, 'Pending song must not invent audio metadata');
        await page.fill('#searchInput', added.title);
        await page.waitForFunction(title => state.query === title && !searchRenderTimer, added.title);
        assert.match(await page.locator('#resultsList').innerText(), /Weekly Fixture Song 8675309/);
        await require('./ui-helpers').plan(page);
        assert.equal(await page.locator('#resultsList .add-button').count(), 1);
        await page.locator('#resultsList .add-button').click();
        assert.equal(await page.evaluate(() => state.setlist.length), 1);
        await page.reload();
        await page.waitForFunction(() => state.songs.length && !document.querySelector('.skeleton'));
        assert.equal(await page.evaluate(() => state.setlist[0].song), added.title);
        assert.equal(await page.evaluate(() => getSongIdentity(state.setlist[0])), added.identity);
        assert.deepEqual(external, [], 'Browser verification must make no live requests');
        console.log(`ok   ${name}: published pending song loads, searches, saves and retains its identity`);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

(async () => {
    const prepare = path.join(temp, 'prepare');
    fs.mkdirSync(prepare);
    for (const file of git(root, 'ls-files').split('\n')) {
        const target = path.join(prepare, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
    }
    git(prepare, 'init', '--quiet', '-b', 'main');
    git(prepare, 'config', 'user.name', 'Weekly fixture');
    git(prepare, 'config', 'user.email', 'fixture@example.invalid');
    git(prepare, 'add', '.'); git(prepare, 'commit', '--quiet', '-m', 'Local fixture baseline');
    git(temp, 'init', '--quiet', '--bare', '--initial-branch=main', 'origin.git');
    git(prepare, 'remote', 'add', 'origin', path.join(temp, 'origin.git'));
    git(prepare, 'push', '--quiet', 'origin', 'main');
    const base = remoteHead();
    const original = snapshot(prepare);
    const songs = JSON.parse(original.get(files[0]));
    const rows = songs.map(song => ({ Artist: song.artist, Song: song.song }));
    rows.push({ Artist: 'Weekly Fixture Artist 8675309', Song: 'Weekly Fixture Song 8675309' });
    rows.push({ Artist: 'Weekly Fixture Artist 8675309 Wvocal', Song: 'Weekly Fixture Song 8675309' });
    const report = await syncVenue({ root: prepare, write: true,
        fetchOptions: { fetchImpl: async () => new Response(JSON.stringify(rows)) } });
    assert.equal(report.added, 1);
    shellStep('Validate updated catalog', prepare);
    const expected = snapshot(prepare);
    shellStep('Package validated additions', prepare);
    const artifact = path.join(prepare, 'metadata_cache');

    const verify = clone('verify', artifact, 'verify');
    shellStep('Apply validated additions', verify);
    unchanged(verify, expected);
    shellStep('Validate updated catalog', verify);
    // Later verification/npm code cannot change what publication consumes.
    fs.appendFileSync(path.join(verify, 'karaoke_explorer.js'), '\n// fixture verification mutation\n');

    const publish = clone('publish', artifact, 'publish');
    shellStep('Verify and apply validated additions', publish);
    unchanged(publish, expected);
    const output = path.join(publish, 'metadata_cache', 'commit-output');
    shellStep('Revalidate and commit additions', publish, { ADDED: '1', GITHUB_OUTPUT: output });
    assert.equal(fs.readFileSync(output, 'utf8'), 'created=true\n');
    assert.deepEqual(git(publish, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), [...files].sort());
    assert.equal(git(publish, 'rev-parse', 'HEAD^'), base);
    shellStep('Publish additions', publish);
    assert.equal(remoteHead(), git(publish, 'rev-parse', 'HEAD'));
    unchanged(publish, expected);
    console.log('ok   new-song prepare, immutable artifact, both validations, seven-file commit and local publication');
    if (process.argv.includes('--browser')) await browserCheck(publish);

    const tampered = clone('tampered', artifact, 'publish');
    const beforeTamper = snapshot(tampered);
    fs.appendFileSync(path.join(tampered, 'metadata_cache/publish/songbook-update.tar'), 'tampered');
    assert.match(shellStep('Verify and apply validated additions', tampered, {}, false).stdout, /FAILED/);
    unchanged(tampered, beforeTamper);
    const tamperedVerify = clone('tampered-verify', artifact, 'verify');
    const beforeVerify = snapshot(tamperedVerify);
    fs.appendFileSync(path.join(tamperedVerify, 'metadata_cache/verify/songbook-update.tar'), 'tampered');
    shellStep('Apply validated additions', tamperedVerify, {}, false);
    unchanged(tamperedVerify, beforeVerify);

    const unexpected = clone('unexpected', artifact, 'publish');
    const beforeUnexpected = snapshot(unexpected);
    fs.writeFileSync(path.join(unexpected, 'unexpected.txt'), 'must not publish');
    run(bash, ['--noprofile', '--norc', '-eo', 'pipefail', '-c',
        'tar -rf metadata_cache/publish/songbook-update.tar unexpected.txt; cd metadata_cache/publish; sha256sum songbook-update.tar > songbook-update.tar.sha256'], unexpected);
    fs.unlinkSync(path.join(unexpected, 'unexpected.txt'));
    assert.match(shellStep('Verify and apply validated additions', unexpected, {}, false).stdout, /Unexpected publication file/);
    assert.equal(fs.existsSync(path.join(unexpected, 'unexpected.txt')), false);
    unchanged(unexpected, beforeUnexpected);
    console.log('ok   verify/publish reject checksum corruption; publication rejects an unexpected artifact path before extraction');

    const incomplete = clone('incomplete-package', artifact, 'publish');
    fs.unlinkSync(path.join(incomplete, 'audio_enrichment.json'));
    shellStep('Package validated additions', incomplete, {}, false);
    assert.equal(fs.existsSync(path.join(incomplete, 'metadata_cache/songbook-update.tar.sha256')), false,
        'Incomplete packaging must stop before generating an uploadable checksum');

    // A valid no-change artifact must not create a commit or enable a push.
    const noop = clone('noop', artifact, 'publish');
    const noopOutput = path.join(noop, 'metadata_cache', 'commit-output');
    shellStep('Revalidate and commit additions', noop, { ADDED: '0', GITHUB_OUTPUT: noopOutput });
    assert.equal(fs.existsSync(noopOutput), false);
    assert.equal(git(noop, 'rev-parse', 'HEAD'), remoteHead());

    // Restore the local origin to the prepared baseline for two race fixtures.
    git(path.join(temp, 'origin.git'), 'update-ref', 'refs/heads/main', base);
    const stale = clone('stale', artifact, 'publish');
    shellStep('Verify and apply validated additions', stale);
    git(prepare, 'commit', '--quiet', '--allow-empty', '-m', 'Concurrent owner change');
    git(prepare, 'push', '--quiet', 'origin', 'main');
    const changed = remoteHead();
    const staleOutput = path.join(stale, 'metadata_cache', 'commit-output');
    assert.match(shellStep('Revalidate and commit additions', stale, { ADDED: '1', GITHUB_OUTPUT: staleOutput }, false).stdout, /Main changed/);
    assert.equal(git(stale, 'rev-parse', 'HEAD'), base);
    assert.equal(fs.existsSync(staleOutput), false);
    assert.equal(remoteHead(), changed);

    git(path.join(temp, 'origin.git'), 'update-ref', 'refs/heads/main', base);
    const race = clone('race', artifact, 'publish');
    shellStep('Verify and apply validated additions', race);
    shellStep('Revalidate and commit additions', race, { ADDED: '1', GITHUB_OUTPUT: path.join(race, 'metadata_cache', 'commit-output') });
    git(path.join(temp, 'origin.git'), 'update-ref', 'refs/heads/main', changed);
    const rejected = shellStep('Publish additions', race, {}, false);
    assert.match(rejected.stderr, /rejected|fetch first|non-fast-forward/);
    assert.equal(remoteHead(), changed);
    console.log('ok   no-op has no commit/output; stale prepared main and post-commit push race preserve concurrent changes');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
