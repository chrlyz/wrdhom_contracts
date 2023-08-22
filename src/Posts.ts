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
} from 'snarkyjs';

// ============================================================================

export const fieldToFlagPostsAsDeleted = Field(93137);
export const genesisKey = Field(6343515);

// ============================================================================

export class PostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  postIndex: Field,
  userPostIndex: Field,
  postedAtBlockHeight: Field,
  deletedAtBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.posterAddress
        .toFields()
        .concat([
          this.postContentID.hash(),
          this.postIndex,
          this.userPostIndex,
          this.postedAtBlockHeight,
          this.deletedAtBlockHeight,
        ])
    );
  }
}

// ============================================================================

export class PostsTransition extends Struct({
  initialPostsGenesisRoot: Field,
  latestPostsGenesisRoot: Field,
  initialPostsRoot: Field,
  latestPostsRoot: Field,
  blockHeight: Field,
}) {
  static createGenesisPostTransition(
    signature: Signature,
    initialPostsGenesisRoot: Field,
    latestPostsGenesisRoot: Field,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    genesisPostWitness: MerkleMapWitness,
    postState: PostState,
    postWitness: MerkleMapWitness
  ) {
    postState.postIndex.assertEquals(Field(1));
    postState.userPostIndex.assertEquals(Field(1));
    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [postsGenesisRootBefore, genesisPostKey] =
      genesisPostWitness.computeRootAndKey(Field(0));
    postsGenesisRootBefore.assertEquals(initialPostsGenesisRoot);
    genesisPostKey.assertEquals(genesisKey);

    const postsGenesisRootAfter = genesisPostWitness.computeRootAndKey(
      Field(1)
    )[0];
    postsGenesisRootAfter.assertEquals(latestPostsGenesisRoot);

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    postsRootBefore.assertEquals(initialPostsRoot);
    postKey.assertEquals(
      Poseidon.hash(
        postState.posterAddress
          .toFields()
          .concat(postState.postContentID.hash())
      )
    );

    const postsRootAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsGenesisRoot: postsGenesisRootBefore,
      latestPostsGenesisRoot: postsGenesisRootAfter,
      initialPostsRoot: postsRootBefore,
      latestPostsRoot: postsRootAfter,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static createUserGenesisPostTransition(
    signature: Signature,
    initialPostsGenesisRoot: Field,
    latestPostsGenesisRoot: Field,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    userGenesisPostWitness: MerkleMapWitness,
    previousPostPostState: PostState,
    previousPostWitness: MerkleMapWitness,
    postState: PostState,
    postWitness: MerkleMapWitness
  ) {
    previousPostPostState.postIndex.assertEquals(postState.postIndex.sub(1));
    postState.userPostIndex.assertEquals(Field(1));
    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [postsGenesisRootBefore, genesisPostKey] =
      userGenesisPostWitness.computeRootAndKey(Field(0));
    postsGenesisRootBefore.assertEquals(initialPostsGenesisRoot);
    genesisPostKey.assertEquals(
      Poseidon.hash(postState.posterAddress.toFields().concat(genesisKey))
    );

    const postsGenesisRootAfter = userGenesisPostWitness.computeRootAndKey(
      Field(1)
    )[0];
    postsGenesisRootAfter.assertEquals(latestPostsGenesisRoot);

    const [previousDerivedPostsRootBefore, previousPostKey] =
      previousPostWitness.computeRootAndKey(previousPostPostState.hash());
    previousDerivedPostsRootBefore.assertEquals(initialPostsRoot);
    previousPostKey.assertEquals(
      Poseidon.hash(
        previousPostPostState.posterAddress
          .toFields()
          .concat(previousPostPostState.postContentID.hash())
      )
    );

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    postsRootBefore.assertEquals(initialPostsRoot);
    postKey.assertEquals(
      Poseidon.hash(
        postState.posterAddress
          .toFields()
          .concat(postState.postContentID.hash())
      )
    );

    const postsRootAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsGenesisRoot: postsGenesisRootBefore,
      latestPostsGenesisRoot: postsGenesisRootAfter,
      initialPostsRoot: postsRootBefore,
      latestPostsRoot: postsRootAfter,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static createPostPublishingTransition(
    signature: Signature,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    previousPostPostState: PostState,
    previousPostWitness: MerkleMapWitness,
    postState: PostState,
    postWitness: MerkleMapWitness,
    initialPostsGenesisRoot: Field,
    latestPostsGenesisRoot: Field
  ) {
    previousPostPostState.postIndex.assertEquals(postState.postIndex.sub(1));
    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [previousDerivedPostsRootBefore, previousPostKey] =
      previousPostWitness.computeRootAndKey(previousPostPostState.hash());
    previousDerivedPostsRootBefore.assertEquals(initialPostsRoot);
    previousPostKey.assertEquals(
      Poseidon.hash(
        previousPostPostState.posterAddress
          .toFields()
          .concat(previousPostPostState.postContentID.hash())
      )
    );

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    postsRootBefore.assertEquals(initialPostsRoot);
    postKey.assertEquals(
      Poseidon.hash(
        postState.posterAddress
          .toFields()
          .concat(postState.postContentID.hash())
      )
    );

    const postsRootAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsGenesisRoot: initialPostsGenesisRoot,
      latestPostsGenesisRoot: latestPostsGenesisRoot,
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    initialPostState: PostState,
    postWitness: MerkleMapWitness,
    blockHeight: Field,
    initialPostsGenesisRoot: Field,
    latestPostsGenesisRoot: Field
  ) {
    const postStateHash = initialPostState.hash();
    const isSigned = signature.verify(initialPostState.posterAddress, [
      postStateHash,
      fieldToFlagPostsAsDeleted,
    ]);
    isSigned.assertTrue();

    const postsRootBefore = postWitness.computeRootAndKey(
      initialPostState.hash()
    )[0];
    postsRootBefore.assertEquals(initialPostsRoot);

    const latestPostState = new PostState({
      posterAddress: initialPostState.posterAddress,
      postContentID: initialPostState.postContentID,
      postIndex: initialPostState.postIndex,
      userPostIndex: initialPostState.userPostIndex,
      postedAtBlockHeight: initialPostState.postedAtBlockHeight,
      deletedAtBlockHeight: blockHeight,
    });

    const postsRootAfter = postWitness.computeRootAndKey(
      latestPostState.hash()
    )[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsGenesisRoot: initialPostsGenesisRoot,
      latestPostsGenesisRoot: latestPostsGenesisRoot,
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      blockHeight: blockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialPostsGenesisRoot.assertEquals(
      transition2.initialPostsGenesisRoot
    );
    transition1.latestPostsGenesisRoot.assertEquals(
      transition2.latestPostsGenesisRoot
    );
    transition1.initialPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsRoot.assertEquals(transition2.latestPostsRoot);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestPostsGenesisRoot.assertEquals(
      transition2.initialPostsGenesisRoot
    );
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialPostsGenesisRoot: transition1.initialPostsGenesisRoot,
      latestPostsGenesisRoot: transition2.latestPostsGenesisRoot,
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      blockHeight: transition2.blockHeight,
    });
  }
}

// ============================================================================

export const Posts = Experimental.ZkProgram({
  publicInput: PostsTransition,

  methods: {
    proveGenesisPostTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        PostState,
        MerkleMapWitness,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsGenesisRoot: Field,
        latestPostsGenesisRoot: Field,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        genesisPostWitness: MerkleMapWitness,
        postState: PostState,
        postWitness: MerkleMapWitness
      ) {
        const computedTransition = PostsTransition.createGenesisPostTransition(
          signature,
          initialPostsGenesisRoot,
          latestPostsGenesisRoot,
          initialPostsRoot,
          latestPostsRoot,
          genesisPostWitness,
          postState,
          postWitness
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveUserGenesisPostTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        PostState,
        MerkleMapWitness,
        PostState,
        MerkleMapWitness,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsGenesisRoot: Field,
        latestPostsGenesisRoot: Field,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        userGenesisPostWitness: MerkleMapWitness,
        previousPostPostState: PostState,
        previousPostWitness: MerkleMapWitness,
        postState: PostState,
        postWitness: MerkleMapWitness
      ) {
        const computedTransition =
          PostsTransition.createUserGenesisPostTransition(
            signature,
            initialPostsGenesisRoot,
            latestPostsGenesisRoot,
            initialPostsRoot,
            latestPostsRoot,
            userGenesisPostWitness,
            previousPostPostState,
            previousPostWitness,
            postState,
            postWitness
          );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    provePostPublishingTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        PostState,
        MerkleMapWitness,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        previousPostPostState: PostState,
        previousPostWitness: MerkleMapWitness,
        postState: PostState,
        postWitness: MerkleMapWitness,
        initialPostsGenesisRoot: Field,
        latestPostsGenesisRoot: Field
      ) {
        const computedTransition =
          PostsTransition.createPostPublishingTransition(
            signature,
            initialPostsRoot,
            latestPostsRoot,
            previousPostPostState,
            previousPostWitness,
            postState,
            postWitness,
            initialPostsGenesisRoot,
            latestPostsGenesisRoot
          );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    provePostDeletionTransition: {
      privateInputs: [
        Signature,
        Field,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        initialPostState: PostState,
        postWitness: MerkleMapWitness,
        blockHeight: Field,
        initialPostsGenesisRoot: Field,
        latestPostsGenesisRoot: Field
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          initialPostsRoot,
          latestPostsRoot,
          initialPostState,
          postWitness,
          blockHeight,
          initialPostsGenesisRoot,
          latestPostsGenesisRoot
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedPostsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostsTransitions: PostsTransition,
        postsTransition1Proof: SelfProof<PostsTransition, undefined>,
        postsTransition2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsTransition1Proof.verify();
        postsTransition2Proof.verify();

        const computedTransition = PostsTransition.mergePostsTransitions(
          postsTransition1Proof.publicInput,
          postsTransition2Proof.publicInput
        );
        PostsTransition.assertEquals(
          computedTransition,
          mergedPostsTransitions
        );
      },
    },
  },
});

export let PostsProof_ = Experimental.ZkProgram.Proof(Posts);
export class PostsProof extends PostsProof_ {}

// ============================================================================
