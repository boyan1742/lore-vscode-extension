// Output captured from lore 0.10.1 (see the probes in the project history). Kept verbatim, including odd whitespace.

export const STATUS_CLEAN = `Repository 01a1725a88f27d10b8aa85ac1f823719
On branch main revision 1 -> 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Remote revision 1 -> 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Local branch in sync with remote
`;

export const STATUS_DIRTY = `Repository 01a1725a469d7cb291573250714878e9
On branch feat revision 1 -> 226032c9e99004fb747996921ad53b3cf3c28802c7a041d09218ef3b262ab4fd
Changes staged for commit:
A b.txt
Changes not staged for commit:
M a.txt
D sp ace.txt
Untracked files:
A c.txt
Tracked changes: 1 added, 1 modified
`;

export const STATUS_MERGING = `Repository 01a1725a88f27d10b8aa85ac1f823719
On branch main revision 2 -> 538f491279d043392fdd9da9abfd3b9e8df0190dbca251fd58b9b318eee5147c
Remote revision 1 -> 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Local branch is ahead of remote
Pending merge, incoming revision c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Changes staged for commit:
A f.txt (M)
Changes in conflict:
M  a.txt (M)!
`;

export const STATUS_NO_REMOTE_BRANCH = `Repository 01a1725a88f27d10b8aa85ac1f823719
On branch clean1 revision 4 -> a5d761dee28d562a024685b95e14cdba34f4a76881c6bbaec85cf75b0c02cc58
Remote branch does not exist
No tracked changes
`;

export const BRANCH_LIST_REMOTE = `Local branches:
  feat
* main
Archived local branches:
  old-work
Remote branches:
  main
`;

export const BRANCH_LIST_OFFLINE = `Local branches:
* main
Warning: Could not query remote branch list
`;

export const BRANCH_INFO = `Branch main
  ID: e726318bbc3fd75ac8733a7e030cc35b
  Latest: 226032c9e99004fb747996921ad53b3cf3c28802c7a041d09218ef3b262ab4fd
  Remote Latest: 0000000000000000000000000000000000000000000000000000000000000000
  Created: Sun, 25 Oct 2026 09:18:01 +0000
`;

// main: 1 base, 2 main edit, 3 merge of feat. feat: 2' feat edit (parent = base).
export const HISTORY_MAIN = `Revision  : 3
Signature : 1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3
Merge     : c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Branch    : e726318bbc3fd75ac8733a7e030cc35b
Merger    : tester
Date      : Sun, 25 Oct 2026 09:18:24 +0000
    merge feat into main
Creator   : tester
Committer : tester

Revision  : 2
Signature : 538f491279d043392fdd9da9abfd3b9e8df0190dbca251fd58b9b318eee5147c
Branch    : e726318bbc3fd75ac8733a7e030cc35b
Date      : Sun, 25 Oct 2026 09:18:19 +0000
    main edit
Creator   : tester
Committer : tester

Revision  : 1
Signature : 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Branch    : e726318bbc3fd75ac8733a7e030cc35b
Date      : Sun, 25 Oct 2026 09:18:18 +0000
    base
Creator   : tester
Committer : tester
`;

export const HISTORY_FEAT = `Revision  : 2
Signature : c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Parent    : 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Branch    : 01a1725a8a957093b6a0ca36e5d11a58
Date      : Sun, 25 Oct 2026 09:18:18 +0000
    feat edit
Creator   : tester
Committer : tester

Revision  : 1
Signature : 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b
Branch    : e726318bbc3fd75ac8733a7e030cc35b
Date      : Sun, 25 Oct 2026 09:18:18 +0000
    base
Creator   : tester
Committer : tester
`;

export const BRANCH_DIFF_CLEAN = `Branch diff branch 01a1725c97267bf0a1a9e69eb5f3269b revision 5484bedec6e8dd56e9310702e776030d4c8c4afa2dfe59c3117eaa3d8dd42a2d -> branch e726318bbc3fd75ac8733a7e030cc35b revision 1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3
Revision diff base 1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3 source 5484bedec6e8dd56e9310702e776030d4c8c4afa2dfe59c3117eaa3d8dd42a2d target 1b8146f1d1fc42e1e26bffabf0c90341c5c21c12d457ec1b5297fd1ff83824b3
Found 4 changes
M a.txt
D f.txt
A g.txt
A sp ace.txt
`;

export const BRANCH_DIFF_CONFLICT = `Branch diff branch e726318bbc3fd75ac8733a7e030cc35b revision 538f491279d043392fdd9da9abfd3b9e8df0190dbca251fd58b9b318eee5147c -> branch 01a1725a8a957093b6a0ca36e5d11a58 revision c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Revision diff base 71064776ea1fdd873f2decdc046bdcebcd3e963c32dd212eb4eadc9fdfbd217b source 538f491279d043392fdd9da9abfd3b9e8df0190dbca251fd58b9b318eee5147c target c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Found 0 changes
Found 1 conflicts
C a.txt
`;

export const MERGE_CLEAN = `Starting merge of branch 01a1725c97267bf0a1a9e69eb5f3269b revision 5484bedec6e8dd56e9310702e776030d4c8c4afa2dfe59c3117eaa3d8dd42a2d
Merged files, 3 updated, 1 deleted, 0 merged, 0 conflicted
Staged merged repository state 2d507e3c25e2d605a383e65cd550e29a9994a74453502e0fdbd9bc8c375a410e
Fragmenting files and updating tree hashes
Stored history for 3 nodes
Committed merged repository state 6 -> b94cb3c511c8612c5e9950780ec01b931dcb7e989aec9b644f02d0117778d80c
`;

export const MERGE_CONFLICT = `Starting merge of branch 01a1725a8a957093b6a0ca36e5d11a58 revision c9aa8da44da07b65da40c2bc2e033c9eed6463f659f876300fae0b68fa0c96b2
Merged files, 1 updated, 0 deleted, 0 merged, 1 conflicted
Staged merged repository state a759fdd4c71c1564ea8adc374115946d5ecbb0da537f49bc913b7065d4e34a94
Files in conflict:
a.txt
`;

export const REPO_INFO = `demo2 (01a1725a88f27d10b8aa85ac1f823719)

Remote URL: lore://127.0.0.1:41337
Default branch: main (e726318bbc3fd75ac8733a7e030cc35b)
Creator: tester
Created: Sun, 25 Oct 2026 09:18:18 +0000
Instance: 01a1725a890579f1ae64b58a53f80d6c
`;
