# Group

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ExternalId** | **string** | External group ID | 
**Name** | Pointer to **string** | Group name | [optional] 
**Description** | Pointer to **string** | Group description | [optional] 
**MemberCount** | Pointer to **float32** | Number of members | [optional] 
**CreatedAt** | Pointer to **time.Time** | Creation timestamp | [optional] 
**CreatedBy** | Pointer to **string** | Creator ID | [optional] 
**IsReadOnly** | Pointer to **bool** | Whether group is read-only | [optional] 
**PlatformMetadata** | Pointer to **map[string]interface{}** | Platform-specific metadata | [optional] 

## Methods

### NewGroup

`func NewGroup(externalId string, ) *Group`

NewGroup instantiates a new Group object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGroupWithDefaults

`func NewGroupWithDefaults() *Group`

NewGroupWithDefaults instantiates a new Group object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetExternalId

`func (o *Group) GetExternalId() string`

GetExternalId returns the ExternalId field if non-nil, zero value otherwise.

### GetExternalIdOk

`func (o *Group) GetExternalIdOk() (*string, bool)`

GetExternalIdOk returns a tuple with the ExternalId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExternalId

`func (o *Group) SetExternalId(v string)`

SetExternalId sets ExternalId field to given value.


### GetName

`func (o *Group) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Group) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Group) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *Group) HasName() bool`

HasName returns a boolean if a field has been set.

### GetDescription

`func (o *Group) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *Group) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *Group) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *Group) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetMemberCount

`func (o *Group) GetMemberCount() float32`

GetMemberCount returns the MemberCount field if non-nil, zero value otherwise.

### GetMemberCountOk

`func (o *Group) GetMemberCountOk() (*float32, bool)`

GetMemberCountOk returns a tuple with the MemberCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMemberCount

`func (o *Group) SetMemberCount(v float32)`

SetMemberCount sets MemberCount field to given value.

### HasMemberCount

`func (o *Group) HasMemberCount() bool`

HasMemberCount returns a boolean if a field has been set.

### GetCreatedAt

`func (o *Group) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *Group) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *Group) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.

### HasCreatedAt

`func (o *Group) HasCreatedAt() bool`

HasCreatedAt returns a boolean if a field has been set.

### GetCreatedBy

`func (o *Group) GetCreatedBy() string`

GetCreatedBy returns the CreatedBy field if non-nil, zero value otherwise.

### GetCreatedByOk

`func (o *Group) GetCreatedByOk() (*string, bool)`

GetCreatedByOk returns a tuple with the CreatedBy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedBy

`func (o *Group) SetCreatedBy(v string)`

SetCreatedBy sets CreatedBy field to given value.

### HasCreatedBy

`func (o *Group) HasCreatedBy() bool`

HasCreatedBy returns a boolean if a field has been set.

### GetIsReadOnly

`func (o *Group) GetIsReadOnly() bool`

GetIsReadOnly returns the IsReadOnly field if non-nil, zero value otherwise.

### GetIsReadOnlyOk

`func (o *Group) GetIsReadOnlyOk() (*bool, bool)`

GetIsReadOnlyOk returns a tuple with the IsReadOnly field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsReadOnly

`func (o *Group) SetIsReadOnly(v bool)`

SetIsReadOnly sets IsReadOnly field to given value.

### HasIsReadOnly

`func (o *Group) HasIsReadOnly() bool`

HasIsReadOnly returns a boolean if a field has been set.

### GetPlatformMetadata

`func (o *Group) GetPlatformMetadata() map[string]interface{}`

GetPlatformMetadata returns the PlatformMetadata field if non-nil, zero value otherwise.

### GetPlatformMetadataOk

`func (o *Group) GetPlatformMetadataOk() (*map[string]interface{}, bool)`

GetPlatformMetadataOk returns a tuple with the PlatformMetadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformMetadata

`func (o *Group) SetPlatformMetadata(v map[string]interface{})`

SetPlatformMetadata sets PlatformMetadata field to given value.

### HasPlatformMetadata

`func (o *Group) HasPlatformMetadata() bool`

HasPlatformMetadata returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


