import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  CircuitString,
  MerkleMapWitness,
} from 'o1js';

// ============================================================================

export const fieldToFlagPostsAsDeleted = Field(93137);
export const fieldToFlagPostsAsRestored = Field(1010);

// ============================================================================

export class PostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  allPostsCounter: Field,
  userPostsCounter: Field,
  postBlockHeight: Field,
  deletionBlockHeight: Field,
  restorationBlockHeight: Field
}) {
  hash(): Field {
    return Poseidon.hash(
      this.posterAddress
        .toFields()
        .concat([
          this.postContentID.hash(),
          this.allPostsCounter,
          this.userPostsCounter,
          this.postBlockHeight,
          this.deletionBlockHeight,
          this.restorationBlockHeight
        ])
    );
  }
}

// ============================================================================

export class PostsTransition extends Struct({
  initialAllPostsCounter: Field,
  latestAllPostsCounter: Field,
  initialUsersPostsCounters: Field,
  latestUsersPostsCounters: Field,
  initialPosts: Field,
  latestPosts: Field,
  blockHeight: Field,
}) {
  static createPostPublishingTransition(
    signature: Signature,
    initialAllPostsCounter: Field,
    initialUsersPostsCounters: Field,
    latestUsersPostsCounters: Field,
    initialUserPostsCounter: Field,
    userPostsCounterWitness: MerkleMapWitness,
    initialPosts: Field,
    latestPosts: Field,
    postState: PostState,
    postWitness: MerkleMapWitness
  ) {
    initialAllPostsCounter.assertEquals(postState.allPostsCounter.sub(1));
    postState.deletionBlockHeight.assertEquals(Field(0));
    postState.restorationBlockHeight.assertEquals(Field(0));

    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [usersPostsCountersBefore, userPostsCounterKey] =
      userPostsCounterWitness.computeRootAndKey(initialUserPostsCounter);
    usersPostsCountersBefore.assertEquals(initialUsersPostsCounters);
    const posterAddressAsField = Poseidon.hash(
      postState.posterAddress.toFields()
    );
    userPostsCounterKey.assertEquals(posterAddressAsField);
    initialUserPostsCounter.assertEquals(postState.userPostsCounter.sub(1));

    const usersPostsCountersAfter = userPostsCounterWitness.computeRootAndKey(
      postState.userPostsCounter
    )[0];
    usersPostsCountersAfter.assertEquals(latestUsersPostsCounters);

    const [postsBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    postsBefore.assertEquals(initialPosts);
    postKey.assertEquals(
      Poseidon.hash([posterAddressAsField, postState.postContentID.hash()])
    );

    const postsAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsAfter.assertEquals(latestPosts);

    return new PostsTransition({
      initialAllPostsCounter: initialAllPostsCounter,
      latestAllPostsCounter: postState.allPostsCounter,
      initialUsersPostsCounters: usersPostsCountersBefore,
      latestUsersPostsCounters: usersPostsCountersAfter,
      initialPosts: postsBefore,
      latestPosts: postsAfter,
      blockHeight: postState.postBlockHeight,
    });
  }

  hash() {
    return Poseidon.hash(
      [
        this.initialAllPostsCounter,
        this.latestAllPostsCounter,
        this.initialUsersPostsCounters,
        this.latestUsersPostsCounters,
        this.initialPosts,
        this.latestPosts,
        this.blockHeight,
      ]
    );
  }
}

// ============================================================================

export class ZkProgramMethodInputs extends Struct({
  transition: PostsTransition,
  signature: Signature,
  initialAllPostsCounter: Field,
  initialUsersPostsCounters: Field,
  latestUsersPostsCounters: Field,
  initialUserPostsCounter: Field,
  userPostsCounterWitness: MerkleMapWitness,
  initialPosts: Field,
  latestPosts: Field,
  postState: PostState,
  postWitness: MerkleMapWitness
}) {}

// ============================================================================

export class PostsBlock extends Struct({
  zkProgramMethodInputs: ZkProgramMethodInputs
}) {
  hash(): Field {
    return Poseidon.hash(
      [this.zkProgramMethodInputs.transition.hash()]
      .concat(this.zkProgramMethodInputs.signature.toFields())
      .concat([
      this.zkProgramMethodInputs.initialAllPostsCounter,
      this.zkProgramMethodInputs.initialUsersPostsCounters,
      this.zkProgramMethodInputs.latestUsersPostsCounters,
      this.zkProgramMethodInputs.initialUserPostsCounter
      ])
      .concat(this.zkProgramMethodInputs.userPostsCounterWitness.toFields())
      .concat([
      this.zkProgramMethodInputs.initialPosts,
      this.zkProgramMethodInputs.latestPosts,
      this.zkProgramMethodInputs.postState.hash()
      ])
      .concat(this.zkProgramMethodInputs.postWitness.toFields())
    );
  }
}

// ============================================================================

export class PostsBlockHash extends Struct({
  postsBlock: PostsBlock,
  postsBlockHash: Field,
}) {}

// ============================================================================

export class LastValidStateHash extends Struct({
  field1: Field,
  field2: Field,
  field3: Field,
  field4: Field,
  field5: Field,
  lastValidStateHash: Field
}) {}

// ============================================================================

export const PostsBlockHashing = ZkProgram({
  name: 'PostsBlockHashing',
  publicInput: PostsBlockHash,

  methods: {
    provePostsBlockHash: {
      privateInputs: [],

      async method(
        provedPostsBlock: PostsBlockHash
      ) {
        const computedHash = provedPostsBlock.postsBlock.hash();
        computedHash.assertEquals(provedPostsBlock.postsBlockHash)
      },
    },
  },
});

export let PostsBlockProof_ = ZkProgram.Proof(PostsBlockHashing);
export class PostsBlockProof extends PostsBlockProof_ {}

// ============================================================================
