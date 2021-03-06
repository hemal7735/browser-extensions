import { propertyIsDefined } from '@sourcegraph/codeintellify/lib/helpers'
import { Observable, of, zip } from 'rxjs'
import { filter, map, switchMap } from 'rxjs/operators'

import { resolveRev, retryWhenCloneInProgressError } from '../../shared/repo/backend'
import { FileInfo } from '../code_intelligence'
import { getBaseCommitIDForCommit, getBaseCommitIDForMergeRequest } from './api'
import {
    getCommitPageInfo,
    getDiffPageInfo,
    getFilePageInfo,
    getFilePathsFromCodeView,
    getHeadCommitIDFromCodeView,
} from './scrape'

const ensureRevisionsAreCloned = (files: Observable<FileInfo>): Observable<FileInfo> =>
    files.pipe(
        switchMap(({ repoPath, rev, baseRev, ...rest }) => {
            // Although we get the commit SHA's from elesewhere, we still need to
            // use `resolveRev` otherwise we can't guarantee Sourcegraph has the
            // revision cloned.
            const resolvingHeadRev = resolveRev({ repoPath, rev }).pipe(retryWhenCloneInProgressError())
            const resolvingBaseRev = resolveRev({ repoPath, rev: baseRev }).pipe(retryWhenCloneInProgressError())

            return zip(resolvingHeadRev, resolvingBaseRev).pipe(map(() => ({ repoPath, rev, baseRev, ...rest })))
        })
    )

/**
 * Resolves file information for a page with a single file, not including diffs with only one file.
 */
export const resolveFileInfo = (codeView: HTMLElement): Observable<FileInfo> =>
    of(undefined).pipe(
        map(() => {
            const { repoPath, filePath, rev } = getFilePageInfo()

            return { repoPath, filePath, rev }
        }),
        filter(propertyIsDefined('filePath')),
        switchMap(({ repoPath, rev, ...rest }) =>
            resolveRev({ repoPath, rev }).pipe(
                retryWhenCloneInProgressError(),
                map(commitID => ({ ...rest, repoPath, commitID, rev: rev || commitID }))
            )
        )
    )

/**
 * Gets `FileInfo` for a diff file.
 */
export const resolveDiffFileInfo = (codeView: HTMLElement): Observable<FileInfo> =>
    of(undefined).pipe(
        map(getDiffPageInfo),
        // Resolve base commit ID.
        switchMap(({ owner, repoName, mergeRequestID, diffID, baseCommitID, ...rest }) => {
            const gettingBaseCommitID = baseCommitID
                ? // Commit was found in URL.
                  of(baseCommitID)
                : // Commit needs to be fetched from the API.
                  getBaseCommitIDForMergeRequest({ owner, repoName, mergeRequestID, diffID })

            return gettingBaseCommitID.pipe(map(baseCommitID => ({ baseCommitID, baseRev: baseCommitID, ...rest })))
        }),
        map(info => {
            // Head commit is found in the "View file @ ..." button in the code view.
            const head = getHeadCommitIDFromCodeView(codeView)

            return {
                ...info,

                rev: head,
                commitID: head,
            }
        }),
        map(info => ({
            ...info,
            // Find both head and base file path if the name has changed.
            ...getFilePathsFromCodeView(codeView),
        })),
        map(info => ({
            ...info,

            // https://github.com/sourcegraph/browser-extensions/issues/185
            headHasFileContents: true,
            baseHasFileContents: true,
        })),
        ensureRevisionsAreCloned
    )

/**
 * Resolves file information for commit pages.
 */
export const resolveCommitFileInfo = (codeView: HTMLElement): Observable<FileInfo> =>
    of(undefined).pipe(
        map(getCommitPageInfo),
        // Resolve base commit ID.
        switchMap(({ owner, repoName, commitID, ...rest }) =>
            getBaseCommitIDForCommit({ owner, repoName, commitID }).pipe(
                map(baseCommitID => ({ owner, repoName, commitID, baseCommitID, ...rest }))
            )
        ),
        map(info => ({ ...info, rev: info.commitID, baseRev: info.baseCommitID })),
        map(info => ({
            ...info,
            // Find both head and base file path if the name has changed.
            ...getFilePathsFromCodeView(codeView),
        })),
        map(info => ({
            ...info,

            // https://github.com/sourcegraph/browser-extensions/issues/185
            headHasFileContents: true,
            baseHasFileContents: true,
        })),
        ensureRevisionsAreCloned
    )
