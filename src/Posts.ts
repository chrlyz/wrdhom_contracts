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

// ============================================================================

export class PostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  postIndex: Field,
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
          this.postedAtBlockHeight,
          this.deletedAtBlockHeight,
        ])
    );
  }
}

// ============================================================================

export class PostsTransition extends Struct({
  initialPostsRoot: Field,
  latestPostsRoot: Field,
  initialNumberOfPosts: Field,
  latestNumberOfPosts: Field,
  blockHeight: Field,
}) {
  static createPostsTransition(
    signature: Signature,
    postState: PostState,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: MerkleMapWitness,

    initialNumberOfPosts: Field
  ) {
    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    postsRootBefore.assertEquals(initialPostsRoot);
    postKey.assertEquals(
      Poseidon.hash(
        postState.posterAddress
          .toFields()
          .concat(postState.postContentID.hash())
      )
    );

    initialNumberOfPosts.assertEquals(postState.postIndex.sub(1));

    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const postsRootAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      initialNumberOfPosts: initialNumberOfPosts,
      latestNumberOfPosts: postState.postIndex,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsRoot.assertEquals(transition2.latestPostsRoot);
    transition1.initialNumberOfPosts.assertEquals(
      transition2.initialNumberOfPosts
    );
    transition1.latestNumberOfPosts.assertEquals(
      transition2.latestNumberOfPosts
    );
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestNumberOfPosts.assertEquals(
      transition2.initialNumberOfPosts
    );
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      initialNumberOfPosts: transition1.initialNumberOfPosts,
      latestNumberOfPosts: transition2.latestNumberOfPosts,
      blockHeight: transition2.blockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    initialPostState: PostState,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: MerkleMapWitness,

    numberOfPosts: Field,
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
      initialNumberOfPosts: numberOfPosts,
      latestNumberOfPosts: numberOfPosts,
      blockHeight: blockHeight,
    });
  }
}

// ============================================================================

export const Posts = Experimental.ZkProgram({
  publicInput: PostsTransition,

  methods: {
    provePostsTransition: {
      privateInputs: [
        Signature,
        PostState,
        Field,
        Field,
        MerkleMapWitness,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        postState: PostState,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: MerkleMapWitness,
        initialPostsNumber: Field
      ) {
        const computedTransition = PostsTransition.createPostsTransition(
          signature,
          postState,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          initialPostsNumber
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    provePostDeletionTransition: {
      privateInputs: [
        Signature,
        PostState,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostState: PostState,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: MerkleMapWitness,
        postsNumber: Field,
        blockHeight: Field
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          initialPostState,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          postsNumber,
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
