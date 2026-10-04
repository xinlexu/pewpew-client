export function serviceReleaseFromMetadata(metadata) {
  const dependency = metadata.packages
    .find((pkg) => pkg.name === 'pewpew-client')
    ?.dependencies.find((dep) => dep.name === 'clash_verge_service_ipc')
  if (!dependency || !/^=\d+\.\d+\.\d+$/.test(dependency.req)) {
    throw new Error(
      'Pin the background service dependency to an exact version before packaging.',
    )
  }
  return `v${dependency.req.slice(1)}`
}

export function serviceCacheMatches(cache, target, version, hashes) {
  return (
    cache?.target === target &&
    cache?.version === version &&
    Object.entries(hashes).every(
      ([file, hash]) => hash && cache.hashes?.[file] === hash,
    )
  )
}
