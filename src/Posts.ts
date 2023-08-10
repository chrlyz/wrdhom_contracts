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
const genesisKey = Field(6343515);

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

export class PostsGenesisTransition extends Struct({
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

    return new PostsGenesisTransition({
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

    return new PostsGenesisTransition({
      initialPostsGenesisRoot: postsGenesisRootBefore,
      latestPostsGenesisRoot: postsGenesisRootAfter,
      initialPostsRoot: postsRootBefore,
      latestPostsRoot: postsRootAfter,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static assertEquals(
    transition1: PostsGenesisTransition,
    transition2: PostsGenesisTransition
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
    transition1: PostsGenesisTransition,
    transition2: PostsGenesisTransition
  ) {
    transition1.latestPostsGenesisRoot.assertEquals(
      transition2.initialPostsGenesisRoot
    );
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsGenesisTransition({
      initialPostsGenesisRoot: transition1.initialPostsGenesisRoot,
      latestPostsGenesisRoot: transition2.latestPostsGenesisRoot,
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      blockHeight: transition2.blockHeight,
    });
  }
}

// ============================================================================

export const PostsGenesis = Experimental.ZkProgram({
  publicInput: PostsGenesisTransition,

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
        transition: PostsGenesisTransition,
        signature: Signature,
        initialPostsGenesisRoot: Field,
        latestPostsGenesisRoot: Field,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        genesisPostWitness: MerkleMapWitness,
        postState: PostState,
        postWitness: MerkleMapWitness
      ) {
        const computedTransition =
          PostsGenesisTransition.createGenesisPostTransition(
            signature,
            initialPostsGenesisRoot,
            latestPostsGenesisRoot,
            initialPostsRoot,
            latestPostsRoot,
            genesisPostWitness,
            postState,
            postWitness
          );
        PostsGenesisTransition.assertEquals(computedTransition, transition);
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
        transition: PostsGenesisTransition,
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
          PostsGenesisTransition.createUserGenesisPostTransition(
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
        PostsGenesisTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedPostsGenesisTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostsTransitions: PostsGenesisTransition,
        postsTransition1Proof: SelfProof<PostsGenesisTransition, undefined>,
        postsTransition2Proof: SelfProof<PostsGenesisTransition, undefined>
      ) {
        postsTransition1Proof.verify();
        postsTransition2Proof.verify();

        postsTransition1Proof.publicInput.latestPostsGenesisRoot.assertEquals(
          postsTransition2Proof.publicInput.initialPostsGenesisRoot
        );
        postsTransition1Proof.publicInput.initialPostsGenesisRoot.assertEquals(
          mergedPostsTransitions.initialPostsGenesisRoot
        );
        postsTransition2Proof.publicInput.latestPostsGenesisRoot.assertEquals(
          mergedPostsTransitions.latestPostsGenesisRoot
        );

        postsTransition1Proof.publicInput.latestPostsRoot.assertEquals(
          postsTransition2Proof.publicInput.initialPostsRoot
        );
        postsTransition1Proof.publicInput.initialPostsRoot.assertEquals(
          mergedPostsTransitions.initialPostsRoot
        );
        postsTransition2Proof.publicInput.latestPostsRoot.assertEquals(
          mergedPostsTransitions.latestPostsRoot
        );

        postsTransition1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
        postsTransition2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
      },
    },
  },
});

export let PostsGenesisProof_ = Experimental.ZkProgram.Proof(PostsGenesis);
export class PostsGenesisProof extends PostsGenesisProof_ {}

// ============================================================================

export class PostsTransition extends Struct({
  initialPostsRoot: Field,
  latestPostsRoot: Field,
  blockHeight: Field,
}) {
  static createPostPublishingTransition(
    signature: Signature,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    previousPostPostState: PostState,
    previousPostWitness: MerkleMapWitness,
    postState: PostState,
    postWitness: MerkleMapWitness
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
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsRoot.assertEquals(transition2.latestPostsRoot);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      blockHeight: transition2.blockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    initialPostsRoot: Field,
    latestPostsRoot: Field,
    initialPostState: PostState,
    postWitness: MerkleMapWitness,
    blockHeight: Field
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
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
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
        PostState,
        MerkleMapWitness,
        PostState,
        MerkleMapWitness,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        previousPostPostState: PostState,
        previousPostWitness: MerkleMapWitness,
        postState: PostState,
        postWitness: MerkleMapWitness
      ) {
        const computedTransition =
          PostsTransition.createPostPublishingTransition(
            signature,
            initialPostsRoot,
            latestPostsRoot,
            previousPostPostState,
            previousPostWitness,
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
        PostState,
        MerkleMapWitness,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        initialPostState: PostState,
        postWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          initialPostsRoot,
          latestPostsRoot,
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
        mergedPostsTransitions: PostsTransition,
        postsTransition1Proof: SelfProof<PostsTransition, undefined>,
        postsTransition2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsTransition1Proof.verify();
        postsTransition2Proof.verify();

        postsTransition1Proof.publicInput.latestPostsRoot.assertEquals(
          postsTransition2Proof.publicInput.initialPostsRoot
        );
        postsTransition1Proof.publicInput.initialPostsRoot.assertEquals(
          mergedPostsTransitions.initialPostsRoot
        );
        postsTransition2Proof.publicInput.latestPostsRoot.assertEquals(
          mergedPostsTransitions.latestPostsRoot
        );

        postsTransition1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
        postsTransition2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
      },
    },
  },
});

export let PostsProof_ = Experimental.ZkProgram.Proof(Posts);
export class PostsProof extends PostsProof_ {}
