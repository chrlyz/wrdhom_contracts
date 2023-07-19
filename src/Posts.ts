import {
  Field,
  Struct,
  MerkleMapWitness,
  PublicKey,
  Signature,
  Poseidon,
  Experimental,
  SelfProof,
  Bool,
} from 'snarkyjs';

// ============================================================================

export const fieldToFlagPostsAsDeleted = Field(93137);

// ============================================================================

export class PostState extends Struct({
  postNumber: Field,
  blockHeight: Field,
  deletedPost: Bool,
  deletedAtBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash([
      this.postNumber,
      this.blockHeight,
      this.deletedPost.toField(),
      this.deletedAtBlockHeight,
    ]);
  }
}

// ============================================================================

export class PostsTransition extends Struct({
  initialPostsRoot: Field,
  latestPostsRoot: Field,
  initialPostsNumber: Field,
  latestPostsNumber: Field,
  blockHeight: Field,
}) {
  static createPostsTransition(
    signature: Signature,
    userAddress: PublicKey,
    hashedPost: Field,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: MerkleMapWitness,

    initialPostsNumber: Field,
    postState: PostState
  ) {
    const isSigned = signature.verify(userAddress, [hashedPost]);
    isSigned.assertTrue();

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(Field(0));
    initialPostsRoot.assertEquals(postsRootBefore);
    Poseidon.hash(userAddress.toFields().concat(hashedPost)).assertEquals(
      postKey
    );

    initialPostsNumber.add(Field(1)).assertEquals(postState.postNumber);
    postState.deletedPost.assertFalse();
    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const postsRootAfter = postWitness.computeRootAndKey(postState.hash())[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      initialPostsNumber: initialPostsNumber,
      latestPostsNumber: postState.postNumber,
      blockHeight: postState.blockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsRoot.assertEquals(transition2.latestPostsRoot);
    transition1.initialPostsNumber.assertEquals(transition2.initialPostsNumber);
    transition1.latestPostsNumber.assertEquals(transition2.latestPostsNumber);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsNumber.assertEquals(transition2.initialPostsNumber);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      initialPostsNumber: transition1.initialPostsNumber,
      latestPostsNumber: transition2.latestPostsNumber,
      blockHeight: transition2.blockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    userAddress: PublicKey,
    hashedPost: Field,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: MerkleMapWitness,

    postsNumber: Field,
    blockHeight: Field,
    initialPostState: PostState
  ) {
    const isSigned = signature.verify(userAddress, [
      hashedPost,
      fieldToFlagPostsAsDeleted,
    ]);
    isSigned.assertTrue();

    const [postsRootBefore, postKey] = postWitness.computeRootAndKey(
      initialPostState.hash()
    );
    initialPostsRoot.assertEquals(postsRootBefore);
    Poseidon.hash(userAddress.toFields().concat(hashedPost)).assertEquals(
      postKey
    );
    initialPostState.deletedPost.assertFalse();
    initialPostState.deletedAtBlockHeight.assertEquals(Field(0));

    const latestPostState = new PostState({
      postNumber: initialPostState.postNumber,
      blockHeight: initialPostState.blockHeight,
      deletedPost: Bool(true),
      deletedAtBlockHeight: blockHeight,
    });

    const postsRootAfter = postWitness.computeRootAndKey(
      latestPostState.hash()
    )[0];
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      initialPostsNumber: postsNumber,
      latestPostsNumber: postsNumber,
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
        PublicKey,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        PostState,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        userAddress: PublicKey,
        hashedPost: Field,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: MerkleMapWitness,
        initialPostsNumber: Field,
        postState: PostState
      ) {
        const computedTransition = PostsTransition.createPostsTransition(
          signature,
          userAddress,
          hashedPost,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          initialPostsNumber,
          postState
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

        postsTransition1Proof.publicInput.latestPostsNumber.assertEquals(
          postsTransition2Proof.publicInput.initialPostsNumber
        );
        postsTransition1Proof.publicInput.initialPostsNumber.assertEquals(
          mergedPostsTransitions.initialPostsNumber
        );
        postsTransition2Proof.publicInput.latestPostsNumber.assertEquals(
          mergedPostsTransitions.latestPostsNumber
        );

        postsTransition1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
        postsTransition2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
      },
    },

    provePostDeletionTransition: {
      privateInputs: [
        Signature,
        PublicKey,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        PostState,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        userAddress: PublicKey,
        hashedPost: Field,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: MerkleMapWitness,
        postsNumber: Field,
        blockHeight: Field,
        initialPostState: PostState
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          userAddress,
          hashedPost,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          postsNumber,
          blockHeight,
          initialPostState
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let PostsProof_ = Experimental.ZkProgram.Proof(Posts);
export class PostsProof extends PostsProof_ {}

// ============================================================================
