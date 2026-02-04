# PaginationMeta

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**HasMore** | **bool** | Whether there are more items | 
**Cursor** | **NullableString** | Cursor for next page | 

## Methods

### NewPaginationMeta

`func NewPaginationMeta(hasMore bool, cursor NullableString, ) *PaginationMeta`

NewPaginationMeta instantiates a new PaginationMeta object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPaginationMetaWithDefaults

`func NewPaginationMetaWithDefaults() *PaginationMeta`

NewPaginationMetaWithDefaults instantiates a new PaginationMeta object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetHasMore

`func (o *PaginationMeta) GetHasMore() bool`

GetHasMore returns the HasMore field if non-nil, zero value otherwise.

### GetHasMoreOk

`func (o *PaginationMeta) GetHasMoreOk() (*bool, bool)`

GetHasMoreOk returns a tuple with the HasMore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasMore

`func (o *PaginationMeta) SetHasMore(v bool)`

SetHasMore sets HasMore field to given value.


### GetCursor

`func (o *PaginationMeta) GetCursor() string`

GetCursor returns the Cursor field if non-nil, zero value otherwise.

### GetCursorOk

`func (o *PaginationMeta) GetCursorOk() (*string, bool)`

GetCursorOk returns a tuple with the Cursor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCursor

`func (o *PaginationMeta) SetCursor(v string)`

SetCursor sets Cursor field to given value.


### SetCursorNil

`func (o *PaginationMeta) SetCursorNil(b bool)`

 SetCursorNil sets the value for Cursor to be an explicit nil

### UnsetCursor
`func (o *PaginationMeta) UnsetCursor()`

UnsetCursor ensures that no value is present for Cursor, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


