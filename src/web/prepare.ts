import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import yaml from 'js-yaml';
import { ISession } from '../session/types';
import { tic } from '../export/utils/exec';
import { publicPath, serverPath } from './utils';
import { Options } from './types';
import { DocumentCache } from './cache';
import { LocalProjectPage, SiteProject } from '../types';
import { selectors } from '../store';
import { CURVENOTE_YML } from '../newconfig';
import { getSiteManifest, loadProjectConfigFromDisk } from '../toc';

export function cleanBuiltFiles(session: ISession, opts: Options, info = true) {
  const toc = tic();
  fs.rmSync(path.join(serverPath(opts), 'app', 'content'), { recursive: true, force: true });
  fs.rmSync(path.join(publicPath(opts), '_static'), { recursive: true, force: true });
  const log = info ? session.log.info : session.log.debug;
  log(toc('🧹 Clean build files in %s.'));
}

export function ensureBuildFoldersExist(session: ISession, opts: Options) {
  session.log.debug('Build folders created for `app/content` and `_static`.');
  fs.mkdirSync(path.join(serverPath(opts), 'app', 'content'), { recursive: true });
  fs.mkdirSync(path.join(publicPath(opts), '_static'), { recursive: true });
}

export async function buildProject(cache: DocumentCache, siteProject: SiteProject) {
  const toc = tic();
  const { store, log } = cache.session;
  const project = loadProjectConfigFromDisk(store, siteProject.path);
  // Load the citations first, or else they are loaded in each call below
  await cache.getCitationRenderer(siteProject.path);
  const pages = await Promise.all([
    cache.processFile(siteProject, { file: project.file, slug: project.index }),
    ...project.pages
      .filter((page): page is LocalProjectPage => 'slug' in page)
      .map((page) => cache.processFile(siteProject, page)),
  ]);
  const touched = pages.flat().filter(({ processed }) => processed).length;
  if (touched) {
    log.info(toc(`📚 Built ${touched} / ${pages.length} pages for ${siteProject.slug} in %s.`));
  } else {
    log.info(toc(`📚 ${pages.length} pages loaded from cache for ${siteProject.slug} in %s.`));
  }
  return {
    pages,
    touched,
  };
}

export async function writeSiteManifest(session: ISession, opts: Options) {
  const configPath = path.join(serverPath(opts), 'app', 'config.json');
  session.log.info('⚙️  Writing site config.json');
  const siteManifest = getSiteManifest(session);
  fs.writeFileSync(configPath, JSON.stringify(siteManifest));
}

export async function buildSite(session: ISession, opts: Options): Promise<DocumentCache> {
  const cache = new DocumentCache(session, opts);

  if (opts.force || opts.clean) {
    cleanBuiltFiles(session, opts);
  }
  ensureBuildFoldersExist(session, opts);

  const siteConfig = selectors.selectLocalSiteConfig(session.store.getState());
  session.log.debug(`Site Config:\n\n${yaml.dump(siteConfig)}`);

  if (!siteConfig?.projects.length) return cache;
  await Promise.all(siteConfig.projects.map((siteProject) => buildProject(cache, siteProject)));
  await writeSiteManifest(session, opts);
  return cache;
}

export function watchContent(session: ISession) {
  const processor = () => async (eventType: string, filename: string) => {
    if (filename.startsWith('_build')) return;
    session.log.debug(`File modified: "${filename}" (${eventType})`);
    session.log.debug('Rebuilding everything 😱');
    await buildSite(session, {});
  };

  // Watch the full content folder
  // try {
  //   // TODO: Change this to a singe watch
  //   cache.config?.site.sections.forEach(({ path: folderPath }) => {
  //     chokidar
  //       .watch(folderPath, {
  //         ignoreInitial: true,
  //         awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
  //       })
  //       .on('all', processor(folderPath));
  //   });
  //   // Watch the curvenote.yml
  //   watchConfig(cache);
  // } catch (error) {
  //   cache.session.log.error((error as Error).message);
  //   cache.session.log.error(
  //     '🙈 The file-system watch failed.\n\tThe server should still work, but will require you to restart it manually to see any changes to content.\n\tUse `curvenote start -c` to clear cache and restart.',
  //   );
  // }
  const siteConfig = selectors.selectLocalSiteConfig(session.store.getState());
  if (!siteConfig) return;
  // This doesn't watch new projects if they are added to the content.
  siteConfig.projects.forEach((proj) => {
    fs.watch(proj.path, { recursive: true }, processor());
  });
  fs.watch(CURVENOTE_YML, {}, processor());
}
