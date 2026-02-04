# MergePersons200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**MergedIdentityIds** | **[]string** |  | 
**DeletedPersonId** | **string** |  | 

## Methods

### NewMergePersons200ResponseData

`func NewMergePersons200ResponseData(person SearchPersons200ResponseItemsInner, mergedIdentityIds []string, deletedPersonId string, ) *MergePersons200ResponseData`

NewMergePersons200ResponseData instantiates a new MergePersons200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMergePersons200ResponseDataWithDefaults

`func NewMergePersons200ResponseDataWithDefaults() *MergePersons200ResponseData`

NewMergePersons200ResponseDataWithDefaults instantiates a new MergePersons200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPerson

`func (o *MergePersons200ResponseData) GetPerson() SearchPersons200ResponseItemsInner`

GetPerson returns the Person field if non-nil, zero value otherwise.

### GetPersonOk

`func (o *MergePersons200ResponseData) GetPersonOk() (*SearchPersons200ResponseItemsInner, bool)`

GetPersonOk returns a tuple with the Person field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPerson

`func (o *MergePersons200ResponseData) SetPerson(v SearchPersons200ResponseItemsInner)`

SetPerson sets Person field to given value.


### GetMergedIdentityIds

`func (o *MergePersons200ResponseData) GetMergedIdentityIds() []string`

GetMergedIdentityIds returns the MergedIdentityIds field if non-nil, zero value otherwise.

### GetMergedIdentityIdsOk

`func (o *MergePersons200ResponseData) GetMergedIdentityIdsOk() (*[]string, bool)`

GetMergedIdentityIdsOk returns a tuple with the MergedIdentityIds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMergedIdentityIds

`func (o *MergePersons200ResponseData) SetMergedIdentityIds(v []string)`

SetMergedIdentityIds sets MergedIdentityIds field to given value.


### GetDeletedPersonId

`func (o *MergePersons200ResponseData) GetDeletedPersonId() string`

GetDeletedPersonId returns the DeletedPersonId field if non-nil, zero value otherwise.

### GetDeletedPersonIdOk

`func (o *MergePersons200ResponseData) GetDeletedPersonIdOk() (*string, bool)`

GetDeletedPersonIdOk returns a tuple with the DeletedPersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDeletedPersonId

`func (o *MergePersons200ResponseData) SetDeletedPersonId(v string)`

SetDeletedPersonId sets DeletedPersonId field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


