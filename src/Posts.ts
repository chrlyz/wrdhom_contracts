import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  Experimental,
  SelfProof,
  CircuitString,
  MerkleMapWitness,
} from 'o1js';

// ============================================================================

export const fieldToFlagPostsAsDeleted = Field(93137);

// ============================================================================

export class PostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  allPostsCounter: Field,
  userPostsCounter: Field,
  postBlockHeight: Field,
  deletionBlockHeight: Field,
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
      initialUsersPostsCounters: initialUsersPostsCounters,
      latestUsersPostsCounters: usersPostsCountersAfter,
      initialPosts: initialPosts,
      latestPosts: postsAfter,
      blockHeight: postState.postBlockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialAllPostsCounter.assertEquals(
      transition2.initialAllPostsCounter
    );
    transition1.latestAllPostsCounter.assertEquals(
      transition2.latestAllPostsCounter
    );
    transition1.initialUsersPostsCounters.assertEquals(
      transition2.initialUsersPostsCounters
    );
    transition1.latestUsersPostsCounters.assertEquals(
      transition2.latestUsersPostsCounters
    );
    transition1.initialPosts.assertEquals(transition2.initialPosts);
    transition1.latestPosts.assertEquals(transition2.latestPosts);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestAllPostsCounter.assertEquals(
      transition2.initialAllPostsCounter
    );
    transition1.latestUsersPostsCounters.assertEquals(
      transition2.initialUsersPostsCounters
    );
    transition1.latestPosts.assertEquals(transition2.initialPosts);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialAllPostsCounter: transition1.initialAllPostsCounter,
      latestAllPostsCounter: transition2.latestAllPostsCounter,
      initialUsersPostsCounters: transition1.initialUsersPostsCounters,
      latestUsersPostsCounters: transition2.latestUsersPostsCounters,
      initialPosts: transition1.initialPosts,
      latestPosts: transition2.latestPosts,
      blockHeight: transition1.blockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    initialPosts: Field,
    latestPosts: Field,
    initialPostState: PostState,
    postWitness: MerkleMapWitness,
    blockHeight: Field
  ) {
    const initialPostStateHash = initialPostState.hash();
    const isSigned = signature.verify(initialPostState.posterAddress, [
      initialPostStateHash,
      fieldToFlagPostsAsDeleted,
    ]);
    isSigned.assertTrue();

    const postsBefore = postWitness.computeRootAndKey(initialPostStateHash)[0];
    postsBefore.assertEquals(initialPosts);

    const latestPostState = new PostState({
      posterAddress: initialPostState.posterAddress,
      postContentID: initialPostState.postContentID,
      allPostsCounter: initialPostState.allPostsCounter,
      userPostsCounter: initialPostState.userPostsCounter,
      postBlockHeight: initialPostState.postBlockHeight,
      deletionBlockHeight: blockHeight,
    });

    const postsAfter = postWitness.computeRootAndKey(latestPostState.hash())[0];
    postsAfter.assertEquals(latestPosts);

    return new PostsTransition({
      initialAllPostsCounter: allPostsCounter,
      latestAllPostsCounter: allPostsCounter,
      initialUsersPostsCounters: usersPostsCounters,
      latestUsersPostsCounters: usersPostsCounters,
      initialPosts: initialPosts,
      latestPosts: postsAfter,
      blockHeight: blockHeight,
    });
  }
}

// ============================================================================

export const Posts = Experimental.ZkProgram({
  publicInput: PostsTransition,

  methods: {
    provePostPublishingTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        PostState,
        MerkleMapWitness,
      ],

      method(
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
      ) {
        const computedTransition =
          PostsTransition.createPostPublishingTransition(
            signature,
            initialAllPostsCounter,
            initialUsersPostsCounters,
            latestUsersPostsCounters,
            initialUserPostsCounter,
            userPostsCounterWitness,
            initialPosts,
            latestPosts,
            postState,
            postWitness
          );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    provePostDeletionTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        Field,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        allPostsCounter: Field,
        usersPostsCounters: Field,
        initialPosts: Field,
        latestPosts: Field,
        initialPostState: PostState,
        postWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          allPostsCounter,
          usersPostsCounters,
          initialPosts,
          latestPosts,
          initialPostState,
          postWitness,
          blockHeight
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedPostsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostTransitions: PostsTransition,
        postsDeletion1Proof: SelfProof<PostsTransition, undefined>,
        postsDeletion2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsDeletion1Proof.verify();
        postsDeletion2Proof.verify();

        const computedTransition = PostsTransition.mergePostsTransitions(
          postsDeletion1Proof.publicInput,
          postsDeletion2Proof.publicInput
        );
        PostsTransition.assertEquals(computedTransition, mergedPostTransitions);
      },
    },
  },
});

export let PostsProof_ = Experimental.ZkProgram.Proof(Posts);
export class PostsProof extends PostsProof_ {}

// ============================================================================
