# MarkMessageRead200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** |  | 
**data** | [**MarkMessageRead200ResponseData**](MarkMessageRead200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.mark_message_read200_response import MarkMessageRead200Response

# TODO update the JSON string below
json = "{}"
# create an instance of MarkMessageRead200Response from a JSON string
mark_message_read200_response_instance = MarkMessageRead200Response.from_json(json)
# print the JSON string representation of the object
print(MarkMessageRead200Response.to_json())

# convert the object into a dict
mark_message_read200_response_dict = mark_message_read200_response_instance.to_dict()
# create an instance of MarkMessageRead200Response from a dict
mark_message_read200_response_from_dict = MarkMessageRead200Response.from_dict(mark_message_read200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


