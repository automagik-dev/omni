# ListInstanceContacts200ResponseMeta

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalFetched** | **float32** |  | 
**HasMore** | **bool** |  | 
**Cursor** | Pointer to **string** |  | [optional] 

## Methods

### NewListInstanceContacts200ResponseMeta

`func NewListInstanceContacts200ResponseMeta(totalFetched float32, hasMore bool, ) *ListInstanceContacts200ResponseMeta`

NewListInstanceContacts200ResponseMeta instantiates a new ListInstanceContacts200ResponseMeta object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstanceContacts200ResponseMetaWithDefaults

`func NewListInstanceContacts200ResponseMetaWithDefaults() *ListInstanceContacts200ResponseMeta`

NewListInstanceContacts200ResponseMetaWithDefaults instantiates a new ListInstanceContacts200ResponseMeta object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotalFetched

`func (o *ListInstanceContacts200ResponseMeta) GetTotalFetched() float32`

GetTotalFetched returns the TotalFetched field if non-nil, zero value otherwise.

### GetTotalFetchedOk

`func (o *ListInstanceContacts200ResponseMeta) GetTotalFetchedOk() (*float32, bool)`

GetTotalFetchedOk returns a tuple with the TotalFetched field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalFetched

`func (o *ListInstanceContacts200ResponseMeta) SetTotalFetched(v float32)`

SetTotalFetched sets TotalFetched field to given value.


### GetHasMore

`func (o *ListInstanceContacts200ResponseMeta) GetHasMore() bool`

GetHasMore returns the HasMore field if non-nil, zero value otherwise.

### GetHasMoreOk

`func (o *ListInstanceContacts200ResponseMeta) GetHasMoreOk() (*bool, bool)`

GetHasMoreOk returns a tuple with the HasMore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasMore

`func (o *ListInstanceContacts200ResponseMeta) SetHasMore(v bool)`

SetHasMore sets HasMore field to given value.


### GetCursor

`func (o *ListInstanceContacts200ResponseMeta) GetCursor() string`

GetCursor returns the Cursor field if non-nil, zero value otherwise.

### GetCursorOk

`func (o *ListInstanceContacts200ResponseMeta) GetCursorOk() (*string, bool)`

GetCursorOk returns a tuple with the Cursor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCursor

`func (o *ListInstanceContacts200ResponseMeta) SetCursor(v string)`

SetCursor sets Cursor field to given value.

### HasCursor

`func (o *ListInstanceContacts200ResponseMeta) HasCursor() bool`

HasCursor returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


