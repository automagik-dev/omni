# QrCode

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Qr** | **NullableString** | QR code string | 
**ExpiresAt** | **NullableTime** | QR code expiration | 
**Message** | **string** | Status message | 

## Methods

### NewQrCode

`func NewQrCode(qr NullableString, expiresAt NullableTime, message string, ) *QrCode`

NewQrCode instantiates a new QrCode object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewQrCodeWithDefaults

`func NewQrCodeWithDefaults() *QrCode`

NewQrCodeWithDefaults instantiates a new QrCode object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQr

`func (o *QrCode) GetQr() string`

GetQr returns the Qr field if non-nil, zero value otherwise.

### GetQrOk

`func (o *QrCode) GetQrOk() (*string, bool)`

GetQrOk returns a tuple with the Qr field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQr

`func (o *QrCode) SetQr(v string)`

SetQr sets Qr field to given value.


### SetQrNil

`func (o *QrCode) SetQrNil(b bool)`

 SetQrNil sets the value for Qr to be an explicit nil

### UnsetQr
`func (o *QrCode) UnsetQr()`

UnsetQr ensures that no value is present for Qr, not even an explicit nil
### GetExpiresAt

`func (o *QrCode) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *QrCode) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *QrCode) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.


### SetExpiresAtNil

`func (o *QrCode) SetExpiresAtNil(b bool)`

 SetExpiresAtNil sets the value for ExpiresAt to be an explicit nil

### UnsetExpiresAt
`func (o *QrCode) UnsetExpiresAt()`

UnsetExpiresAt ensures that no value is present for ExpiresAt, not even an explicit nil
### GetMessage

`func (o *QrCode) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *QrCode) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *QrCode) SetMessage(v string)`

SetMessage sets Message field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


