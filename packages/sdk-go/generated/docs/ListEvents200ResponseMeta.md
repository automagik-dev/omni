# ListEvents200ResponseMeta

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**HasMore** | **bool** | Whether there are more items | 
**Cursor** | **NullableString** | Cursor for next page | 
**Total** | Pointer to **int32** |  | [optional] 

## Methods

### NewListEvents200ResponseMeta

`func NewListEvents200ResponseMeta(hasMore bool, cursor NullableString, ) *ListEvents200ResponseMeta`

NewListEvents200ResponseMeta instantiates a new ListEvents200ResponseMeta object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListEvents200ResponseMetaWithDefaults

`func NewListEvents200ResponseMetaWithDefaults() *ListEvents200ResponseMeta`

NewListEvents200ResponseMetaWithDefaults instantiates a new ListEvents200ResponseMeta object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetHasMore

`func (o *ListEvents200ResponseMeta) GetHasMore() bool`

GetHasMore returns the HasMore field if non-nil, zero value otherwise.

### GetHasMoreOk

`func (o *ListEvents200ResponseMeta) GetHasMoreOk() (*bool, bool)`

GetHasMoreOk returns a tuple with the HasMore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasMore

`func (o *ListEvents200ResponseMeta) SetHasMore(v bool)`

SetHasMore sets HasMore field to given value.


### GetCursor

`func (o *ListEvents200ResponseMeta) GetCursor() string`

GetCursor returns the Cursor field if non-nil, zero value otherwise.

### GetCursorOk

`func (o *ListEvents200ResponseMeta) GetCursorOk() (*string, bool)`

GetCursorOk returns a tuple with the Cursor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCursor

`func (o *ListEvents200ResponseMeta) SetCursor(v string)`

SetCursor sets Cursor field to given value.


### SetCursorNil

`func (o *ListEvents200ResponseMeta) SetCursorNil(b bool)`

 SetCursorNil sets the value for Cursor to be an explicit nil

### UnsetCursor
`func (o *ListEvents200ResponseMeta) UnsetCursor()`

UnsetCursor ensures that no value is present for Cursor, not even an explicit nil
### GetTotal

`func (o *ListEvents200ResponseMeta) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *ListEvents200ResponseMeta) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *ListEvents200ResponseMeta) SetTotal(v int32)`

SetTotal sets Total field to given value.

### HasTotal

`func (o *ListEvents200ResponseMeta) HasTotal() bool`

HasTotal returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


